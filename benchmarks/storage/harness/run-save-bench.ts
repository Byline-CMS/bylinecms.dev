/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Single-locale save scenario.
 *
 * Usage:
 *   tsx --env-file=packages/db-postgres/.env \
 *     benchmarks/storage/harness/run-save-bench.ts --scale 10000
 *
 * Assumes `seed.ts` has been run at the same scale. Measures `updateDocument`
 * from `@byline/core/services` with `locale: 'en'`, changing one text field
 * (`summary`) of a seeded `bench-articles` document. This is the lifecycle
 * path that runs the localized-toggle mismatch check on every save.
 *
 * Method: 10 warmup iterations (discarded), then 50 measured iterations, as
 * in `run-bench.ts`. Iteration N saves a different seeded document (the 60
 * most recent), so every save lands on a document with exactly one prior
 * version and version count cannot drift the timing. The document's current
 * revision is read before the timer starts and is not part of the measurement.
 * Saves add versions, so re-seed before each measured run.
 *
 * Emits a markdown report to stdout.
 */

import os from 'node:os'

import { createSuperAdminContext } from '@byline/auth'
import type { BylineLogger } from '@byline/core'
import { type DocumentLifecycleContext, updateDocument } from '@byline/core/services'
import { pgAdapter } from '@byline/db-postgres'

import { BENCH_ARTICLES_PATH, BenchArticles, benchCollections } from './collections.js'

const args = process.argv.slice(2)
function arg(name: string): string | undefined {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

const scale = Number(arg('--scale') ?? 0)
const warmup = Number(arg('--warmup') ?? 10)
const iterations = Number(arg('--iterations') ?? 50)

if (!Number.isFinite(scale) || scale <= 0) {
  console.error('usage: run-save-bench.ts --scale N [--warmup 10] [--iterations 50]')
  process.exit(1)
}

const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
if (!connectionString) {
  console.error('BYLINE_DB_POSTGRES_CONNECTION_STRING is not set')
  process.exit(1)
}

function pick(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}

async function main() {
  const db = pgAdapter({
    connectionString: connectionString!,
    collections: benchCollections,
    defaultContentLocale: 'en',
  })

  const col = await db.queries.collections.getCollectionByPath(BENCH_ARTICLES_PATH)
  if (!col) throw new Error('bench collections not found — run seed.ts --scale N first')
  const collectionId = col.id as string

  const noop = () => {}
  const logger = Object.fromEntries(
    ['log', 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((k) => [k, noop])
  ) as unknown as BylineLogger

  const ctx: DocumentLifecycleContext = {
    db,
    definition: BenchArticles,
    collectionPath: BENCH_ARTICLES_PATH,
    collectionId,
    collectionVersion: 1,
    defaultLocale: 'en',
    logger,
    requestContext: createSuperAdminContext(),
  }

  const total = warmup + iterations
  const list = await db.queries.documents.findDocuments({
    collection_id: collectionId,
    page: 1,
    pageSize: total,
    orderBy: 'created_at',
    orderDirection: 'desc',
  })
  if (list.documents.length < total) throw new Error(`need ${total} seeded articles`)
  const ids = list.documents.map((d: any) => d.document_id as string)

  console.error(`running save bench at scale ${scale} (warmup=${warmup}, iters=${iterations})…`)

  const samples: number[] = []
  for (let i = 0; i < total; i++) {
    const documentId = ids[i]!
    const current = await db.queries.documents.getDocumentById({
      collection_id: collectionId,
      document_id: documentId,
      locale: 'en',
      reconstruct: true,
    })
    if (!current) throw new Error(`document ${documentId} not found`)
    const expectedRevision = (await db.queries.documents.getDocumentRevision({
      collection_id: collectionId,
      document_id: documentId,
    }))!
    const data = structuredClone((current as any).fields) as Record<string, any>
    // `path` is a schema field but lives on the document envelope, not in `fields`.
    data.path = (current as any).path
    data.summary = `${data.summary} (edited ${i})`

    const t0 = performance.now()
    await updateDocument(ctx, { documentId, expectedRevision, locale: 'en', data })
    const elapsed = performance.now() - t0
    if (i >= warmup) samples.push(elapsed)
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const median = pick(sorted, 0.5)
  const p95 = pick(sorted, 0.95)
  console.error(
    `  ${'updateDocument (locale en, one text field)'.padEnd(52)} median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms`
  )

  const out: string[] = []
  out.push(`# Storage save benchmark — scale ${scale.toLocaleString()}`)
  out.push('')
  out.push(`- Run at: ${new Date().toISOString()}`)
  out.push(
    `- Platform: ${os.platform()} ${os.arch()} / ${os.cpus()[0]?.model ?? 'unknown'} / ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM`
  )
  out.push(`- Node: ${process.version}`)
  out.push(`- Warmup: ${warmup}, measured iterations: ${iterations}`)
  out.push('')
  out.push('| Scenario | Median (ms) | p95 (ms) | Min | Max |')
  out.push('|---|---:|---:|---:|---:|')
  out.push(
    `| updateDocument (locale en, one text field) | ${median.toFixed(2)} | ${p95.toFixed(2)} | ${sorted[0]!.toFixed(2)} | ${sorted[sorted.length - 1]!.toFixed(2)} |`
  )
  process.stdout.write(`${out.join('\n')}\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('save bench failed:', err)
  process.exit(1)
})
