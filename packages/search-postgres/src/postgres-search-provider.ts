/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  SearchCapabilities,
  SearchDocument,
  SearchHit,
  SearchProvider,
  SearchQuery,
  SearchResults,
} from '@byline/core'
import type { PortableSearchAnalyzer } from '@byline/search-analysis'
import type { Pool, PoolClient } from 'pg'

import { buildIndexRow, type IndexRow } from './build-index-row.js'
import { SearchAnalyzerMismatchError } from './errors.js'
import { buildPortableIndexVector } from './portable-index-vector.js'
import { buildPortablePostgresQuery } from './portable-query.js'

const CAPABILITIES: SearchCapabilities = {
  // Portable tsvector + ts_rank floor: no IDF, fuzzy matching, vectors,
  // aggregation, or structured `where` filtering yet.
  facets: false,
  typoTolerance: false,
  semantic: false,
  bm25: false,
  weighting: true,
  highlights: false,
  fullText: {
    nativeAnalysis: false,
    portableAnalysis: true,
    allTerms: true,
    anyTerms: true,
    minimumShouldMatch: true,
    phrase: true,
  },
}

/**
 * The built-in PostgreSQL `SearchProvider`. Stores portable logical terms in
 * one weighted tsvector per `(collection_path, document_id, locale)`.
 */
export class PostgresSearchProvider implements SearchProvider {
  readonly capabilities = CAPABILITIES

  constructor(
    private readonly pool: Pool,
    private readonly analyzer: PortableSearchAnalyzer
  ) {}

  async upsert(doc: SearchDocument): Promise<void> {
    const row = buildIndexRow(doc)
    const vector = buildPortableIndexVector(row, this.analyzer)
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO byline_search_index_metadata
           (collection_path, analyzer_fingerprint, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (collection_path) DO NOTHING`,
        [row.collectionPath, vector.analyzerFingerprint]
      )
      const metadata = await client.query<{ analyzer_fingerprint: string }>(
        `SELECT analyzer_fingerprint
         FROM byline_search_index_metadata
         WHERE collection_path = $1
         FOR UPDATE`,
        [row.collectionPath]
      )
      const actualFingerprint = metadata.rows[0]?.analyzer_fingerprint ?? null
      if (actualFingerprint !== vector.analyzerFingerprint) {
        throw new SearchAnalyzerMismatchError(
          row.collectionPath,
          vector.analyzerFingerprint,
          actualFingerprint
        )
      }

      await client.query(UPSERT_SQL, upsertParams(row, vector.value, vector.analyzerFingerprint))
      await client.query('COMMIT')
    } catch (error) {
      await rollback(client)
      throw error
    } finally {
      client.release()
    }
  }

  async remove(ref: {
    collectionPath: string
    documentId: string
    locale?: string
  }): Promise<void> {
    if (ref.locale != null) {
      await this.pool.query(
        `DELETE FROM byline_search_documents
         WHERE collection_path = $1 AND document_id = $2 AND locale = $3`,
        [ref.collectionPath, ref.documentId, ref.locale]
      )
    } else {
      await this.pool.query(
        `DELETE FROM byline_search_documents
         WHERE collection_path = $1 AND document_id = $2`,
        [ref.collectionPath, ref.documentId]
      )
    }
  }

  async reindex(opts: { collectionPath?: string } = {}): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (opts.collectionPath != null) {
        await client.query('DELETE FROM byline_search_index_metadata WHERE collection_path = $1', [
          opts.collectionPath,
        ])
        await client.query('DELETE FROM byline_search_documents WHERE collection_path = $1', [
          opts.collectionPath,
        ])
      } else {
        await client.query('TRUNCATE byline_search_documents')
        await client.query('TRUNCATE byline_search_index_metadata')
      }
      await client.query('COMMIT')
    } catch (error) {
      await rollback(client)
      throw error
    } finally {
      client.release()
    }
  }

  async search(query: SearchQuery): Promise<SearchResults> {
    const plan = this.analyzer.analyzeQuery({
      query: query.query,
      locale: query.locale,
      matching: query.matching,
    })
    const translated = buildPortablePostgresQuery(plan)
    if (translated.tsquery.length === 0) return { hits: [], total: 0 }

    await this.assertAnalyzerFingerprint(query)

    const params: unknown[] = [translated.tsquery]
    const where: string[] = ['d.search_vector @@ q.query']
    if (translated.minimumShouldMatch != null) {
      params.push(translated.conceptTsqueries)
      const conceptsParam = params.length
      params.push(translated.minimumShouldMatch)
      const minimumParam = params.length
      where.push(
        `(SELECT count(*)
          FROM unnest($${conceptsParam}::text[]) AS concept(query_text)
          WHERE d.search_vector @@ to_tsquery('simple', concept.query_text))
         >= $${minimumParam}`
      )
    }
    appendScopeFilters(query, params, where, true)

    const cte = `WITH q AS (SELECT to_tsquery('simple', $1) AS query)`
    const whereSql = where.join(' AND ')
    const countResult = await this.pool.query<{ total: string }>(
      `${cte}
       SELECT count(*)::text AS total
       FROM byline_search_documents d, q
       WHERE ${whereSql}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const limit = query.limit ?? 20
    const offset = query.offset ?? 0
    const limitParam = params.length + 1
    const offsetParam = params.length + 2
    const hitResult = await this.pool.query<HitRow>(
      `${cte}
       SELECT d.collection_path, d.document_id, d.locale, d.title, d.path,
              ts_rank(d.search_vector, q.query) AS score
       FROM byline_search_documents d, q
       WHERE ${whereSql}
       ORDER BY score DESC, d.updated_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset]
    )

    const hits: SearchHit[] = hitResult.rows.map((row) => ({
      collectionPath: row.collection_path,
      documentId: row.document_id,
      locale: row.locale,
      title: row.title,
      path: row.path,
      score: Number(row.score),
    }))
    return { hits, total }
  }

  private async assertAnalyzerFingerprint(query: SearchQuery): Promise<void> {
    const params: unknown[] = [this.analyzer.fingerprint]
    const where = ['d.analyzer_fingerprint IS DISTINCT FROM $1']
    appendScopeFilters(query, params, where, false)

    const incompatible = await this.pool.query<{
      collection_path: string
      analyzer_fingerprint: string | null
    }>(
      `SELECT d.collection_path, d.analyzer_fingerprint
       FROM byline_search_documents d
       WHERE ${where.join(' AND ')}
       LIMIT 1`,
      params
    )
    const row = incompatible.rows[0]
    if (row != null) {
      throw new SearchAnalyzerMismatchError(
        row.collection_path,
        this.analyzer.fingerprint,
        row.analyzer_fingerprint
      )
    }
  }
}

interface HitRow {
  collection_path: string
  document_id: string
  locale: string
  title: string
  path: string | null
  score: number
}

function appendScopeFilters(
  query: SearchQuery,
  params: unknown[],
  where: string[],
  includeStatus: boolean
): void {
  if (query.collectionPath != null) {
    params.push(query.collectionPath)
    where.push(`d.collection_path = $${params.length}`)
  }
  if (query.zone != null) {
    params.push([query.zone])
    where.push(`d.zones @> $${params.length}`)
  }
  if (query.locale != null) {
    params.push(query.locale)
    where.push(`d.locale = $${params.length}`)
  }
  if (includeStatus && query.status !== 'any') {
    params.push('published')
    where.push(`d.status = $${params.length}`)
  }
}

function upsertParams(row: IndexRow, vector: string, analyzerFingerprint: string): unknown[] {
  return [
    row.collectionPath,
    row.documentId,
    row.locale,
    row.status,
    row.zones,
    row.title,
    row.path,
    row.body,
    vector,
    analyzerFingerprint,
    JSON.stringify(row.facets),
    JSON.stringify(row.filters),
    row.updatedAt,
  ]
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original operation error.
  }
}

const UPSERT_SQL = `INSERT INTO byline_search_documents
  (collection_path, document_id, locale, status, zones, title, path, body,
   search_vector, analyzer_fingerprint, facets, filters, updated_at)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::tsvector, $10,
   $11::jsonb, $12::jsonb, $13)
 ON CONFLICT (collection_path, document_id, locale) DO UPDATE SET
   status = EXCLUDED.status,
   zones = EXCLUDED.zones,
   title = EXCLUDED.title,
   path = EXCLUDED.path,
   body = EXCLUDED.body,
   search_vector = EXCLUDED.search_vector,
   analyzer_fingerprint = EXCLUDED.analyzer_fingerprint,
   facets = EXCLUDED.facets,
   filters = EXCLUDED.filters,
   updated_at = EXCLUDED.updated_at`
