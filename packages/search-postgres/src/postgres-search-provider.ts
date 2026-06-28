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
import type { Pool } from 'pg'

import { buildIndexRow } from './build-index-row.js'
import type { RegconfigResolver } from './locale-regconfig.js'

const CAPABILITIES: SearchCapabilities = {
  // tsvector + ts_rank floor: no IDF, no fuzzy, no vectors. Facet aggregation
  // (the data is indexed) and structured `where` filtering are follow-ups.
  facets: false,
  typoTolerance: false,
  semantic: false,
  bm25: false,
  weighting: true,
  highlights: true,
}

/**
 * The built-in Postgres full-text `SearchProvider`. Stores one weighted
 * `tsvector` row per `(collection_path, document_id, locale)` and ranks with
 * `websearch_to_tsquery` + `ts_rank`. Owns its schema (see `migrate`).
 */
export class PostgresSearchProvider implements SearchProvider {
  readonly capabilities = CAPABILITIES

  constructor(
    private readonly pool: Pool,
    private readonly regconfig: RegconfigResolver,
    /**
     * Locale used to pick the query `regconfig` when a search omits `locale`.
     * Without it, a locale-less query falls back to `simple` (unstemmed) and
     * silently fails to match locale-stemmed vectors. Set to the host's
     * default content locale.
     */
    private readonly defaultLocale?: string
  ) {}

  async upsert(doc: SearchDocument): Promise<void> {
    const row = buildIndexRow(doc)
    const cfg = this.regconfig(row.locale)

    await this.pool.query(
      `INSERT INTO byline_search_documents
         (collection_path, document_id, locale, status, zones, title, path, body,
          search_vector, facets, filters, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
          setweight(to_tsvector($9::regconfig, $10), 'A') ||
          setweight(to_tsvector($9::regconfig, $11), 'B') ||
          setweight(to_tsvector($9::regconfig, $12), 'C') ||
          setweight(to_tsvector($9::regconfig, $13), 'D'),
          $14::jsonb, $15::jsonb, $16)
       ON CONFLICT (collection_path, document_id, locale) DO UPDATE SET
          status = EXCLUDED.status,
          zones = EXCLUDED.zones,
          title = EXCLUDED.title,
          path = EXCLUDED.path,
          body = EXCLUDED.body,
          search_vector = EXCLUDED.search_vector,
          facets = EXCLUDED.facets,
          filters = EXCLUDED.filters,
          updated_at = EXCLUDED.updated_at`,
      [
        row.collectionPath,
        row.documentId,
        row.locale,
        row.status,
        row.zones,
        row.title,
        row.path,
        row.body,
        cfg,
        row.weighted.A,
        row.weighted.B,
        row.weighted.C,
        row.weighted.D,
        JSON.stringify(row.facets),
        JSON.stringify(row.filters),
        row.updatedAt,
      ]
    )
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

  async search(query: SearchQuery): Promise<SearchResults> {
    const cfg = this.regconfig(query.locale ?? this.defaultLocale)
    const limit = query.limit ?? 20
    const offset = query.offset ?? 0

    // $1 = regconfig, $2 = query string; further binds appended below.
    const params: unknown[] = [cfg, query.query]
    const where: string[] = ['d.search_vector @@ q.query']

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
    // Default to published-only; 'any' is the admin escape hatch.
    if (query.status !== 'any') {
      params.push('published')
      where.push(`d.status = $${params.length}`)
    }

    const whereSql = where.join(' AND ')
    const cte = `WITH q AS (SELECT websearch_to_tsquery($1::regconfig, $2) AS query)`

    const countResult = await this.pool.query<{ total: string }>(
      `${cte}
       SELECT count(*)::text AS total
       FROM byline_search_documents d, q
       WHERE ${whereSql}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const limitParam = params.length + 1
    const offsetParam = params.length + 2
    const hitResult = await this.pool.query<HitRow>(
      `${cte}
       SELECT d.collection_path, d.document_id, d.locale, d.title, d.path,
              ts_rank(d.search_vector, q.query) AS score,
              ts_headline($1::regconfig, d.body, q.query,
                'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=24, MinWords=8') AS highlight
       FROM byline_search_documents d, q
       WHERE ${whereSql}
       ORDER BY score DESC, d.updated_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset]
    )

    const hits: SearchHit[] = hitResult.rows.map((r) => ({
      collectionPath: r.collection_path,
      documentId: r.document_id,
      locale: r.locale,
      title: r.title,
      path: r.path,
      score: Number(r.score),
      highlights: r.highlight ? { body: [r.highlight] } : undefined,
    }))

    return { hits, total }
  }
}

interface HitRow {
  collection_path: string
  document_id: string
  locale: string
  title: string
  path: string | null
  score: number
  highlight: string | null
}
