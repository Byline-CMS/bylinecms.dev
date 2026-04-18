/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Seed harness.
 *
 * Usage:
 *   tsx --env-file=packages/db-postgres/.env benchmarks/storage/harness/seed.ts --scale 10000
 *   tsx --env-file=packages/db-postgres/.env benchmarks/storage/harness/seed.ts --teardown
 *
 * Or via the helper scripts in `benchmarks/storage/harness/bench.sh`.
 *
 * Idempotent: on start, drops existing bench collections (cascade to all
 * documents and store rows via the FK graph) and recreates them before
 * seeding. Safe to rerun.
 *
 * Uses tsx's native --env-file to pick up POSTGRES_CONNECTION_STRING (avoids
 * needing `dotenv` as a dep). A missing connection string aborts with a
 * clear error rather than silently connecting to something unexpected.
 */

import { pgAdapter } from '@byline/db-postgres'

import {
  BENCH_ARTICLES_PATH,
  BENCH_MEDIA_PATH,
  BenchArticles,
  BenchMedia,
  benchCollections,
} from './collections.js'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

function arg(name: string): string | undefined {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

const teardownOnly = args.includes('--teardown')
const scale = Number(arg('--scale') ?? 1000)
const chunkSize = Number(arg('--chunk') ?? 40)

if (!teardownOnly && (!Number.isFinite(scale) || scale <= 0)) {
  console.error('usage: seed.ts --scale N [--chunk 40] | --teardown')
  process.exit(1)
}

const connectionString = process.env.POSTGRES_CONNECTION_STRING
if (!connectionString) {
  console.error('POSTGRES_CONNECTION_STRING is not set')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Deterministic content generators
//
// We seed deterministically so two runs at the same scale produce the same
// fixture — important for comparing results across sessions or machines.
// ---------------------------------------------------------------------------

const TOPICS = [
  'architecture',
  'caching',
  'data model',
  'indexing',
  'latency',
  'migrations',
  'partitioning',
  'performance',
  'reliability',
  'scaling',
  'search',
  'storage',
  'throughput',
  'versioning',
  'workflow',
]

const ADJECTIVES = [
  'Adaptive',
  'Canonical',
  'Deterministic',
  'Elastic',
  'Hybrid',
  'Immutable',
  'Layered',
  'Native',
  'Observable',
  'Persistent',
  'Responsive',
  'Scalable',
  'Typed',
  'Unified',
  'Versioned',
]

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function articleContent(i: number, mediaIds: Array<{ document_id: string; collection_id: string }>) {
  const topic = TOPICS[i % TOPICS.length]!
  const adj = ADJECTIVES[(i * 7) % ADJECTIVES.length]!
  const title = `${adj} ${topic.replace(/\b\w/g, (c) => c.toUpperCase())} ${pad(i, 6)}`
  const path = `bench-article-${pad(i, 6)}`
  const slug = path
  const summary = `A deterministic summary about ${topic}. Document number ${i + 1}. Used to exercise text search and textArea storage under realistic scale.`
  const bodyText = `Paragraph ${i + 1} concerning ${topic}. The ${adj.toLowerCase()} approach to this problem is well documented. See also related notes on ${TOPICS[(i + 1) % TOPICS.length]} and ${TOPICS[(i + 2) % TOPICS.length]}.`
  const body = {
    root: {
      children: [
        {
          children: [
            { detail: 0, format: 0, mode: 'normal', style: '', text: bodyText, type: 'text', version: 1 },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
          textFormat: 0,
          textStyle: '',
        },
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }

  // Deterministic spread: views 0-999, rating 0.0-5.0, published over 2 years.
  const views = (i * 37) % 1000
  const rating = Number((((i * 13) % 51) / 10).toFixed(1))
  const publishedAt = new Date(Date.UTC(2024, 0, 1) + ((i * 86400000) % (730 * 86400000)))
  const featured = i % 11 === 0

  const base: Record<string, unknown> = {
    title,
    path,
    slug,
    summary,
    body,
    views,
    rating,
    published_at: publishedAt,
    featured,
  }

  // Every 3rd article gets a hero image; cycle through the media pool.
  // Omit the key entirely rather than passing null — the relation field is
  // optional, so a missing key stores no row in `store_relation`.
  if (i % 3 === 0 && mediaIds.length > 0) {
    const m = mediaIds[i % mediaIds.length]!
    base.hero = {
      target_document_id: m.document_id,
      target_collection_id: m.collection_id,
    }
  }

  return base
}

function mediaContent(i: number) {
  const title = `Bench Media ${pad(i, 6)}`
  const path = `bench-media-${pad(i, 6)}`
  const caption = `Caption text for media item ${i + 1}.`
  return { title, path, caption }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = pgAdapter({ connectionString: connectionString!, collections: benchCollections })

  console.log(`connected to ${connectionString!.replace(/:[^:@]+@/, ':***@')}`)

  // --- Teardown any pre-existing bench collections (cascade removes docs).
  for (const path of [BENCH_ARTICLES_PATH, BENCH_MEDIA_PATH]) {
    const existing = await db.queries.collections.getCollectionByPath(path)
    if (existing) {
      console.log(`tearing down existing collection '${path}' (id=${existing.id})`)
      await db.commands.collections.delete(existing.id as string)
    }
  }

  if (teardownOnly) {
    console.log('teardown complete')
    process.exit(0)
  }

  // --- Register fresh bench collections.
  const mediaCreated = await db.commands.collections.create(BENCH_MEDIA_PATH, BenchMedia)
  const mediaCollectionId = mediaCreated[0]!.id as string
  const articlesCreated = await db.commands.collections.create(BENCH_ARTICLES_PATH, BenchArticles)
  const articlesCollectionId = articlesCreated[0]!.id as string

  console.log(
    `created collections: ${BENCH_MEDIA_PATH}=${mediaCollectionId} ${BENCH_ARTICLES_PATH}=${articlesCollectionId}`
  )

  // --- Seed media pool (size = scale / 50, min 20).
  const mediaCount = Math.max(20, Math.floor(scale / 50))
  console.log(`seeding ${mediaCount} media documents…`)
  const mediaIds: Array<{ document_id: string; collection_id: string }> = []
  const mediaStart = performance.now()
  for (let i = 0; i < mediaCount; i += chunkSize) {
    const batch = Array.from({ length: Math.min(chunkSize, mediaCount - i) }, (_, j) => i + j)
    const results = await Promise.all(
      batch.map((idx) => {
        const data = mediaContent(idx)
        return db.commands.documents.createDocumentVersion({
          collectionId: mediaCollectionId,
          collectionConfig: BenchMedia,
          action: 'create',
          documentData: data,
          path: data.path,
          locale: 'en',
        })
      })
    )
    for (const r of results) {
      mediaIds.push({
        document_id: r.document.document_id as string,
        collection_id: mediaCollectionId,
      })
    }
  }
  const mediaElapsed = performance.now() - mediaStart
  console.log(`media seeded: ${mediaCount} in ${(mediaElapsed / 1000).toFixed(1)}s`)

  // --- Seed articles.
  console.log(`seeding ${scale} article documents (chunk=${chunkSize})…`)
  const articleStart = performance.now()
  let completed = 0
  const progressInterval = Math.max(500, Math.floor(scale / 20))

  for (let i = 0; i < scale; i += chunkSize) {
    const batch = Array.from({ length: Math.min(chunkSize, scale - i) }, (_, j) => i + j)
    await Promise.all(
      batch.map((idx) => {
        const data = articleContent(idx, mediaIds)
        return db.commands.documents.createDocumentVersion({
          collectionId: articlesCollectionId,
          collectionConfig: BenchArticles,
          action: 'create',
          documentData: data,
          path: data.path,
          locale: 'en',
        })
      })
    )
    completed += batch.length
    if (completed % progressInterval < chunkSize || completed === scale) {
      const elapsed = (performance.now() - articleStart) / 1000
      const rate = completed / elapsed
      const eta = (scale - completed) / rate
      console.log(
        `  ${completed}/${scale} (${rate.toFixed(0)} docs/s, eta ${eta.toFixed(0)}s, elapsed ${elapsed.toFixed(0)}s)`
      )
    }
  }
  const articleElapsed = performance.now() - articleStart
  console.log(
    `articles seeded: ${scale} in ${(articleElapsed / 1000).toFixed(1)}s (${(scale / (articleElapsed / 1000)).toFixed(0)} docs/s)`
  )

  process.exit(0)
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
