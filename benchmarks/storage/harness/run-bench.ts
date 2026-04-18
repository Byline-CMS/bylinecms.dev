/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Measurement harness.
 *
 * Usage:
 *   tsx --env-file=packages/db-postgres/.env \
 *     benchmarks/storage/harness/run-bench.ts --scale 10000
 *
 * Assumes `seed.ts` has been run at the same scale. Runs a fixed query mix
 * against the seeded bench collections, reports median / p95 per query
 * across 50 measured iterations (after 10 warmup iterations that are
 * discarded). Emits markdown to stdout — pipe to `results/` to publish.
 *
 * EXPLAIN (ANALYZE, BUFFERS) is also captured once per query shape so the
 * plan can be reviewed alongside the timing numbers.
 */

import { pgAdapter } from '@byline/db-postgres'
import { populateDocuments } from '@byline/core'
import { Pool } from 'pg'
import os from 'node:os'

import {
  BENCH_ARTICLES_PATH,
  BENCH_MEDIA_PATH,
  benchCollections,
} from './collections.js'

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
function arg(name: string): string | undefined {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

const scale = Number(arg('--scale') ?? 0)
const warmup = Number(arg('--warmup') ?? 10)
const iterations = Number(arg('--iterations') ?? 50)

if (!Number.isFinite(scale) || scale <= 0) {
  console.error('usage: run-bench.ts --scale N [--warmup 10] [--iterations 50]')
  process.exit(1)
}

const connectionString = process.env.POSTGRES_CONNECTION_STRING
if (!connectionString) {
  console.error('POSTGRES_CONNECTION_STRING is not set')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

interface Stats {
  median: number
  p95: number
  min: number
  max: number
  samples: number
}

function summarise(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
  return {
    median: pick(0.5),
    p95: pick(0.95),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    samples: sorted.length,
  }
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now()
  await fn()
  return performance.now() - t0
}

async function measure(name: string, fn: () => Promise<unknown>): Promise<Stats> {
  for (let i = 0; i < warmup; i++) await fn()
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    samples.push(await time(fn))
  }
  const s = summarise(samples)
  // stderr so it doesn't pollute the markdown report written to stdout
  console.error(
    `  ${name.padEnd(52)} median=${s.median.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms`
  )
  return s
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = pgAdapter({ connectionString: connectionString!, collections: benchCollections })

  // Separate pool for raw EXPLAIN calls (avoid stepping on the adapter's
  // query pipeline).
  const explainPool = new Pool({ connectionString: connectionString! })

  // Resolve collection IDs.
  const articlesCol = await db.queries.collections.getCollectionByPath(BENCH_ARTICLES_PATH)
  const mediaCol = await db.queries.collections.getCollectionByPath(BENCH_MEDIA_PATH)
  if (!articlesCol || !mediaCol) {
    throw new Error('bench collections not found — run seed.ts --scale N first')
  }
  const articlesCollectionId = articlesCol.id as string
  const mediaCollectionId = mediaCol.id as string

  // Sample a fixture document — pick the 5th from most-recent (arbitrary
  // but reproducible) so the timing target is a real document, not a
  // best-case one.
  const sampleList = await db.queries.documents.findDocuments({
    collection_id: articlesCollectionId,
    page: 1,
    pageSize: 5,
    orderBy: 'created_at',
    orderDirection: 'desc',
  })
  const sampleDoc = sampleList.documents[4] ?? sampleList.documents[0]
  if (!sampleDoc) throw new Error('no seeded articles found')
  const sampleDocumentId = sampleDoc.document_id as string
  const samplePath = sampleDoc.path as string

  // Sample batch: 50 known ids, pulled in one shot from find.
  const batchList = await db.queries.documents.findDocuments({
    collection_id: articlesCollectionId,
    page: 1,
    pageSize: 50,
    orderBy: 'created_at',
    orderDirection: 'desc',
  })
  const batchIds = batchList.documents.map((d: any) => d.document_id as string)

  // Sample population set: 20 docs with hero relations present.
  const populateSourceList = await db.queries.documents.findDocuments({
    collection_id: articlesCollectionId,
    page: 1,
    pageSize: 20,
    orderBy: 'created_at',
    orderDirection: 'desc',
  })

  // ---------------------------------------------------------------------------
  // Run the query mix
  // ---------------------------------------------------------------------------

  console.error(`running bench at scale ${scale} (warmup=${warmup}, iters=${iterations})…`)

  const results: Array<{ name: string; stats: Stats }> = []

  results.push({
    name: 'getDocumentById (full reconstruct)',
    stats: await measure('getDocumentById (full)', () =>
      db.queries.documents.getDocumentById({
        collection_id: articlesCollectionId,
        document_id: sampleDocumentId,
        locale: 'en',
        reconstruct: true,
      })
    ),
  })

  results.push({
    name: "getDocumentById (select=['title'])",
    stats: await measure('getDocumentById (title-only)', () =>
      db.queries.documents.getDocumentsByDocumentIds({
        collection_id: articlesCollectionId,
        document_ids: [sampleDocumentId],
        locale: 'en',
        fields: ['title'],
      })
    ),
  })

  results.push({
    name: 'findDocuments (page 1, size 20)',
    stats: await measure('findDocuments (page size 20)', () =>
      db.queries.documents.findDocuments({
        collection_id: articlesCollectionId,
        page: 1,
        pageSize: 20,
        orderBy: 'created_at',
        orderDirection: 'desc',
        locale: 'en',
      })
    ),
  })

  results.push({
    name: "findDocuments (where title $contains 'storage', sort by views desc)",
    stats: await measure('findDocuments (filter+sort)', () =>
      db.queries.documents.findDocuments({
        collection_id: articlesCollectionId,
        page: 1,
        pageSize: 20,
        filters: [
          {
            fieldName: 'title',
            storeType: 'text',
            valueColumn: 'value',
            operator: '$contains',
            value: 'storage',
          },
        ],
        sort: {
          fieldName: 'views',
          storeType: 'numeric',
          valueColumn: 'value_integer',
          direction: 'desc',
        },
        orderBy: 'created_at',
        orderDirection: 'desc',
        locale: 'en',
      })
    ),
  })

  results.push({
    name: 'getDocumentsByDocumentIds (batch of 50)',
    stats: await measure('getDocumentsByDocumentIds (×50)', () =>
      db.queries.documents.getDocumentsByDocumentIds({
        collection_id: articlesCollectionId,
        document_ids: batchIds,
        locale: 'en',
      })
    ),
  })

  results.push({
    name: 'populateDocuments (depth 2, 20 source docs × 1 relation)',
    stats: await measure('populateDocuments (depth 2)', async () => {
      // Clone so each iteration sees fresh, non-populated inputs.
      const docs = populateSourceList.documents.map((d: any) =>
        JSON.parse(JSON.stringify(d))
      ) as Array<Record<string, any>>
      await populateDocuments({
        db,
        collections: benchCollections,
        collectionId: articlesCollectionId,
        documents: docs,
        populate: true,
        depth: 2,
        locale: 'en',
      })
    }),
  })

  // ---------------------------------------------------------------------------
  // Capture one EXPLAIN (ANALYZE, BUFFERS) per representative query
  // ---------------------------------------------------------------------------

  const explainOutput: Array<{ label: string; sql: string; plan: string[] }> = []

  async function explain(label: string, sql: string, params: any[]) {
    const r = await explainPool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, params)
    explainOutput.push({
      label,
      sql,
      plan: r.rows.map((row: any) => row['QUERY PLAN'] as string),
    })
  }

  await explain(
    'findDocuments list (page size 20)',
    `
    SELECT d.*
    FROM current_documents d
    WHERE d.collection_id = $1
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 20 OFFSET 0
    `,
    [articlesCollectionId]
  )

  await explain(
    "findDocuments with $contains + numeric sort",
    `
    SELECT d.*
    FROM current_documents d
    LEFT JOIN LATERAL (
      SELECT value_integer AS _sort_value
      FROM store_numeric
      WHERE document_version_id = d.id
        AND field_name = 'views'
        AND (locale = 'en' OR locale = 'all')
      LIMIT 1
    ) _sort ON true
    WHERE d.collection_id = $1
      AND EXISTS (
        SELECT 1 FROM store_text
        WHERE document_version_id = d.id
          AND field_name = 'title'
          AND (locale = 'en' OR locale = 'all')
          AND value ILIKE '%storage%'
      )
    ORDER BY _sort._sort_value DESC NULLS LAST
    LIMIT 20
    `,
    [articlesCollectionId]
  )

  await explain(
    'getDocumentsByDocumentIds (batch of 50)',
    `
    SELECT *
    FROM current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
    `,
    [articlesCollectionId, batchIds]
  )

  await explainPool.end()

  // ---------------------------------------------------------------------------
  // Emit markdown report to stdout
  // ---------------------------------------------------------------------------

  const now = new Date().toISOString()
  const cpu = os.cpus()[0]?.model ?? 'unknown'
  const mem = `${Math.round(os.totalmem() / 1024 ** 3)} GB`

  const out: string[] = []
  out.push(`# Storage benchmark — scale ${scale.toLocaleString()}`)
  out.push('')
  out.push(`- Run at: ${now}`)
  out.push(`- Platform: ${os.platform()} ${os.arch()} / ${cpu} / ${mem} RAM`)
  out.push(`- Node: ${process.version}`)
  out.push(`- Warmup: ${warmup}, measured iterations: ${iterations}`)
  out.push(`- Media pool: ${Math.max(20, Math.floor(scale / 50))} docs`)
  out.push('')
  out.push('## Query timings')
  out.push('')
  out.push('| Query | Median (ms) | p95 (ms) | Min | Max |')
  out.push('|---|---:|---:|---:|---:|')
  for (const { name, stats } of results) {
    out.push(
      `| ${name} | ${stats.median.toFixed(2)} | ${stats.p95.toFixed(2)} | ${stats.min.toFixed(2)} | ${stats.max.toFixed(2)} |`
    )
  }
  out.push('')
  out.push('## EXPLAIN (ANALYZE, BUFFERS)')
  out.push('')
  for (const e of explainOutput) {
    out.push(`### ${e.label}`)
    out.push('')
    out.push('```sql')
    out.push(e.sql.trim())
    out.push('```')
    out.push('')
    out.push('```')
    for (const line of e.plan) out.push(line)
    out.push('```')
    out.push('')
  }

  process.stdout.write(out.join('\n') + '\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('bench failed:', err)
  process.exit(1)
})
