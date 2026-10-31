/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Maintenance: fill or verify stored-file content identity (`fileHash` and
 * `storageValidator`) for files uploaded before Byline recorded it.
 *
 * Fill (default) reads each stored object once through the configured storage
 * provider's bound `download`, hashes it, and records the hash and validator
 * on every row for that path that has no hash yet. It never overwrites a
 * recorded hash, so it is idempotent and safe to re-run after an interruption.
 * Missing or unreadable objects are reported and left without identity.
 *
 * Verify (`--verify`) re-hashes paths that already have a recorded hash and
 * reports matches and mismatches. It writes nothing.
 *
 *   cd apps/webapp && pnpm tsx byline/scripts/backfill-file-identity.ts --dry-run
 *   cd apps/webapp && pnpm tsx byline/scripts/backfill-file-identity.ts
 *   cd apps/webapp && pnpm tsx byline/scripts/backfill-file-identity.ts --collection media
 *   cd apps/webapp && pnpm tsx byline/scripts/backfill-file-identity.ts --verify
 *
 * Options: --verify, --collection <path>, --dry-run, --limit <n>,
 * --batch-size <n>. Only rows written by the configured storage provider are
 * selected. See docs/04-collections/06-file-media-uploads.md.
 */

import '../load-env.js'
import '../server.config.js'

import { parseArgs } from 'node:util'

import { getServerConfig } from '@byline/core'
import { backfillStoredFileIdentity } from '@byline/core/stored-files'

function positiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer (got '${value}')`)
  }
  return parsed
}

async function run() {
  const { values } = parseArgs({
    options: {
      verify: { type: 'boolean', default: false },
      collection: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      limit: { type: 'string' },
      'batch-size': { type: 'string' },
    },
  })

  const config = getServerConfig()
  if (!config.storage) {
    throw new Error('No storage provider is configured (ServerConfig.storage).')
  }

  const limit = positiveInteger('limit', values.limit)
  const batchSize = positiveInteger('batch-size', values['batch-size'])
  const summary = await backfillStoredFileIdentity({
    db: config.db,
    storage: config.storage,
    mode: values.verify ? 'verify' : 'fill',
    dryRun: values['dry-run'],
    ...(values.collection !== undefined && { collectionPath: values.collection }),
    ...(limit !== undefined && { limit }),
    ...(batchSize !== undefined && { batchSize }),
  })

  const scope = values.collection ? ` in '${values.collection}'` : ''
  console.log(
    `✓ stored-file identity ${summary.mode}${summary.dryRun ? ' (dry run)' : ''}${scope} — ` +
      `${summary.scanned} path(s) scanned, ${summary.hashed} hashed, ` +
      `${summary.missing} missing, ${summary.failed} failed`
  )
  if (summary.mode === 'fill') {
    console.log(`  ${summary.rowsUpdated} row(s) updated`)
  } else {
    console.log(`  ${summary.matched} hash group(s) matched, ${summary.mismatched} mismatched`)
    for (const m of summary.mismatches) {
      console.log(
        `  ✗ ${m.storagePath}: recorded ${m.recordedHash}, now ${m.currentHash} (${m.rowCount} row(s))`
      )
    }
  }
  for (const path of summary.missingPaths) console.log(`  missing: ${path}`)
  for (const f of summary.failures) console.log(`  failed: ${f.storagePath} — ${f.error}`)
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ stored-file identity backfill failed:', error)
    process.exit(1)
  })
