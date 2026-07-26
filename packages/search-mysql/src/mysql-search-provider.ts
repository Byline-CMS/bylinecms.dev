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
import { highlightPortableText, type PortableSearchAnalyzer } from '@byline/search-analysis'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { buildIndexRow, type IndexRow } from './build-index-row.js'
import { SearchAnalyzerMismatchError } from './errors.js'
import { buildPortableMySqlIndexDocument } from './portable-index-document.js'
import { buildPortableMySqlQuery, type PortableMySqlQuery } from './portable-query.js'

const CAPABILITIES: SearchCapabilities = {
  facets: false,
  typoTolerance: false,
  semantic: false,
  bm25: false,
  weighting: true,
  highlights: true,
  fullText: {
    nativeAnalysis: false,
    portableAnalysis: true,
    allTerms: true,
    anyTerms: true,
    minimumShouldMatch: true,
    phrase: true,
  },
}

/** MySQL FULLTEXT implementation over portable parser-safe logical tokens. */
export class MySqlSearchProvider implements SearchProvider {
  readonly capabilities = CAPABILITIES

  constructor(
    private readonly pool: Pool,
    private readonly analyzer: PortableSearchAnalyzer
  ) {}

  async upsert(doc: SearchDocument): Promise<void> {
    const row = buildIndexRow(doc)
    const indexDocument = buildPortableMySqlIndexDocument(row, this.analyzer)
    const connection = await this.pool.getConnection()

    try {
      await connection.beginTransaction()
      await connection.query(
        `INSERT INTO byline_search_index_metadata
           (collection_path, analyzer_fingerprint, zones, updated_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE collection_path = collection_path`,
        [row.collectionPath, indexDocument.analyzerFingerprint, JSON.stringify(row.zones)]
      )
      const [metadata] = await connection.query<FingerprintRow[]>(
        `SELECT analyzer_fingerprint, zones
         FROM byline_search_index_metadata
         WHERE collection_path = ?
         FOR UPDATE`,
        [row.collectionPath]
      )
      const actualFingerprint = metadata[0]?.analyzer_fingerprint ?? null
      if (actualFingerprint !== indexDocument.analyzerFingerprint) {
        throw new SearchAnalyzerMismatchError(
          row.collectionPath,
          indexDocument.analyzerFingerprint,
          actualFingerprint
        )
      }
      const zones = [
        ...new Set([...(parseJsonStringArray(metadata[0]?.zones) ?? []), ...row.zones]),
      ]
      await connection.query(
        `UPDATE byline_search_index_metadata
         SET zones = ?, updated_at = UTC_TIMESTAMP(6)
         WHERE collection_path = ?`,
        [JSON.stringify(zones), row.collectionPath]
      )

      await connection.query<ResultSetHeader>(UPSERT_SQL, upsertParams(row, indexDocument))
      await connection.commit()
    } catch (error) {
      await rollback(connection)
      throw error
    } finally {
      connection.release()
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
         WHERE collection_path = ? AND document_id = ? AND locale = ?`,
        [ref.collectionPath, ref.documentId, ref.locale]
      )
    } else {
      await this.pool.query(
        `DELETE FROM byline_search_documents
         WHERE collection_path = ? AND document_id = ?`,
        [ref.collectionPath, ref.documentId]
      )
    }
  }

  async reindex(opts: { collectionPath?: string } = {}): Promise<void> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      if (opts.collectionPath != null) {
        await connection.query('DELETE FROM byline_search_documents WHERE collection_path = ?', [
          opts.collectionPath,
        ])
        await connection.query(
          'DELETE FROM byline_search_index_metadata WHERE collection_path = ?',
          [opts.collectionPath]
        )
      } else {
        await connection.query('DELETE FROM byline_search_documents')
        await connection.query('DELETE FROM byline_search_index_metadata')
      }
      await connection.commit()
    } catch (error) {
      await rollback(connection)
      throw error
    } finally {
      connection.release()
    }
  }

  async search(query: SearchQuery): Promise<SearchResults> {
    const plan = this.analyzer.analyzeQuery({
      query: query.query,
      locale: query.locale,
      matching: query.matching,
    })
    const translated = buildPortableMySqlQuery(plan)
    if (translated.rankingQuery.length === 0) return { hits: [], total: 0 }

    await this.assertAnalyzerFingerprint(query)

    const lexical = buildLexicalPredicate(translated)
    const where = [lexical.sql]
    const whereParams: unknown[] = [...lexical.params]
    appendScopeFilters(query, whereParams, where, true)
    const whereSql = where.join(' AND ')

    const [countRows] = await this.pool.query<TotalRow[]>(
      `SELECT COUNT(*) AS total
       FROM byline_search_documents d
       WHERE ${whereSql}`,
      whereParams
    )
    const total = Number(countRows[0]?.total ?? 0)

    const scoreSql = [
      '8 * MATCH(d.search_a) AGAINST (? IN BOOLEAN MODE)',
      '4 * MATCH(d.search_b) AGAINST (? IN BOOLEAN MODE)',
      '2 * MATCH(d.search_c) AGAINST (? IN BOOLEAN MODE)',
      '1 * MATCH(d.search_d) AGAINST (? IN BOOLEAN MODE)',
    ].join(' + ')
    const limit = query.limit ?? 20
    const offset = query.offset ?? 0
    const [hitRows] = await this.pool.query<HitRow[]>(
      `SELECT d.collection_path, d.document_id, d.locale, d.title, d.path, d.body,
              (${scoreSql}) AS score
       FROM byline_search_documents d
       WHERE ${whereSql}
       ORDER BY score DESC, d.updated_at DESC,
                d.collection_path, d.document_id, d.locale
       LIMIT ? OFFSET ?`,
      [
        translated.rankingQuery,
        translated.rankingQuery,
        translated.rankingQuery,
        translated.rankingQuery,
        ...whereParams,
        limit,
        offset,
      ]
    )

    const hits: SearchHit[] = hitRows.map((row) => {
      const highlight = highlightPortableText({
        text: row.body,
        plan,
        analyzer: this.analyzer,
      })
      return {
        collectionPath: row.collection_path,
        documentId: row.document_id,
        locale: row.locale,
        title: row.title,
        path: row.path,
        score: Number(row.score),
        ...(highlight == null ? {} : { highlights: { body: [highlight] } }),
      }
    })
    return { hits, total }
  }

  private async assertAnalyzerFingerprint(query: SearchQuery): Promise<void> {
    const params: unknown[] = [this.analyzer.fingerprint]
    const where = ['m.analyzer_fingerprint <> ?']
    appendMetadataScopeFilters(query, params, where)

    const [rows] = await this.pool.query<IncompatibleRow[]>(
      `SELECT m.collection_path, m.analyzer_fingerprint
       FROM byline_search_index_metadata m
       WHERE ${where.join(' AND ')}
       LIMIT 1`,
      params
    )
    const row = rows[0]
    if (row != null) {
      throw new SearchAnalyzerMismatchError(
        row.collection_path,
        this.analyzer.fingerprint,
        row.analyzer_fingerprint
      )
    }
  }
}

function appendMetadataScopeFilters(query: SearchQuery, params: unknown[], where: string[]): void {
  if (query.collectionPath != null) {
    params.push(query.collectionPath)
    where.push('m.collection_path = ?')
  }
  if (query.zone != null) {
    params.push(query.zone)
    where.push('JSON_CONTAINS(m.zones, JSON_ARRAY(?))')
  }
}

interface FingerprintRow extends RowDataPacket {
  analyzer_fingerprint: string
  zones: string | string[]
}

interface IncompatibleRow extends FingerprintRow {
  collection_path: string
}

interface TotalRow extends RowDataPacket {
  total: number | string
}

interface HitRow extends RowDataPacket {
  collection_path: string
  document_id: string
  locale: string
  title: string
  path: string | null
  body: string
  score: number | string
}

interface PortableIndexValues {
  searchText: string
  weighted: Record<'A' | 'B' | 'C' | 'D', string>
  analyzerFingerprint: string
}

function parseJsonStringArray(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined
  if (Array.isArray(value)) return value
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
    ? parsed
    : undefined
}

function upsertParams(row: IndexRow, indexDocument: PortableIndexValues): unknown[] {
  const updatedAt = new Date(row.updatedAt)
  if (Number.isNaN(updatedAt.valueOf())) {
    throw new TypeError(`Search document updatedAt is invalid: ${row.updatedAt}`)
  }

  return [
    row.collectionPath,
    row.documentId,
    row.locale,
    row.status,
    JSON.stringify(row.zones),
    row.title,
    row.path,
    row.body,
    indexDocument.searchText,
    indexDocument.weighted.A,
    indexDocument.weighted.B,
    indexDocument.weighted.C,
    indexDocument.weighted.D,
    indexDocument.analyzerFingerprint,
    JSON.stringify(row.facets),
    JSON.stringify(row.filters),
    updatedAt,
  ]
}

function buildLexicalPredicate(query: PortableMySqlQuery): {
  sql: string
  params: (string | number)[]
} {
  const params: (string | number)[] = []
  const match = (value: string): string => {
    params.push(value)
    return 'MATCH(d.search_text) AGAINST (? IN BOOLEAN MODE) > 0'
  }

  const concepts = query.conceptQueries.map(match)
  let conceptSql: string
  if (query.minimumShouldMatch != null) {
    params.push(query.minimumShouldMatch)
    conceptSql = `(${concepts.map((sql) => `IF(${sql}, 1, 0)`).join(' + ')}) >= ?`
  } else {
    const operator = query.operator === 'all' ? ' AND ' : ' OR '
    conceptSql = `(${concepts.join(operator)})`
  }

  if (query.gramQueries.length > 0) {
    conceptSql = `(${conceptSql} OR ${query.gramQueries.map(match).join(' OR ')})`
  }

  const clauses = [conceptSql]
  for (const phraseAlternatives of query.phraseQueries) {
    if (phraseAlternatives.length === 0) {
      clauses.push('(FALSE)')
      continue
    }
    clauses.push(`(${phraseAlternatives.map(match).join(' OR ')})`)
  }
  return { sql: clauses.join(' AND '), params }
}

function appendScopeFilters(
  query: SearchQuery,
  params: unknown[],
  where: string[],
  includeStatus: boolean
): void {
  if (query.collectionPath != null) {
    params.push(query.collectionPath)
    where.push('d.collection_path = ?')
  }
  if (query.zone != null) {
    params.push(query.zone)
    where.push("JSON_CONTAINS(d.zones, JSON_QUOTE(?), '$') = 1")
  }
  if (query.locale != null) {
    params.push(query.locale)
    where.push('d.locale = ?')
  }
  if (includeStatus && query.status !== 'any') {
    params.push('published')
    where.push('d.status = ?')
  }
}

async function rollback(connection: PoolConnection): Promise<void> {
  try {
    await connection.rollback()
  } catch {
    // Preserve the original operation error.
  }
}

const UPSERT_SQL = `INSERT INTO byline_search_documents
  (collection_path, document_id, locale, status, zones, title, path, body,
   search_text, search_a, search_b, search_c, search_d, analyzer_fingerprint,
   facets, filters, updated_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON DUPLICATE KEY UPDATE
   status = VALUES(status),
   zones = VALUES(zones),
   title = VALUES(title),
   path = VALUES(path),
   body = VALUES(body),
   search_text = VALUES(search_text),
   search_a = VALUES(search_a),
   search_b = VALUES(search_b),
   search_c = VALUES(search_c),
   search_d = VALUES(search_d),
   analyzer_fingerprint = VALUES(analyzer_fingerprint),
   facets = VALUES(facets),
   filters = VALUES(filters),
   updated_at = VALUES(updated_at)`
