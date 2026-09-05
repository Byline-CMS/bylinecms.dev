/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Bulk re-anchor: move every fully-translated document onto a new content
 * source locale. This is the follow-up to switching `i18n.content.defaultLocale`
 * — Slices 1–4 make the switch *safe* (existing docs keep reading their original
 * anchor); this command actually moves the documents that are complete in the
 * new locale onto it (its fallback floor, path locale, and completeness
 * yardstick). Documents not yet fully translated into the target are skipped and
 * listed — that list is the outstanding-translation backlog. Re-run as
 * translation progresses; it is idempotent (each doc is its own transaction).
 *
 * From the application directory containing byline/:
 *   pnpm tsx byline/scripts/re-anchor.ts --to fr
 *   pnpm tsx byline/scripts/re-anchor.ts --to fr --collection pages
 *   pnpm tsx byline/scripts/re-anchor.ts --to fr --dry-run
 *
 * See docs/08-internationalization/index.md.
 */

import '../load-env.js'
import '../server.config.js'

import { parseArgs } from 'node:util'

import { documentRevisionFromDatabase, getBylineCore, getServerConfig } from '@byline/core'
import type { PgAdapter } from '@byline/db-postgres'

const USAGE =
  'Usage: pnpm tsx byline/scripts/re-anchor.ts --to <locale> [--collection <path>] [--dry-run]'

async function run() {
  const { values } = parseArgs({
    options: {
      to: { type: 'string' },
      collection: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const targetLocale = values.to
  if (!targetLocale) {
    console.error(`✗ missing required --to <locale>.\n${USAGE}`)
    process.exit(1)
  }

  const config = getServerConfig()

  const contentLocales = config.i18n.content.locales
  if (!contentLocales.includes(targetLocale)) {
    console.error(
      `✗ --to '${targetLocale}' is not a configured content locale (${contentLocales.join(', ')})`
    )
    process.exit(1)
  }

  // Resolve an optional collection-path filter to its id via the registered
  // collection records (throws a clear error for an unknown path).
  const collectionPath = values.collection
  const collectionId = collectionPath
    ? getBylineCore().getCollectionRecord(collectionPath).collectionId
    : undefined

  const dryRun = values['dry-run'] ?? false
  const db = config.db as PgAdapter
  const scope = collectionPath ? `collection '${collectionPath}'` : 'all collections'

  console.log(
    `${dryRun ? '[dry-run] ' : ''}re-anchoring ${scope} → content source locale '${targetLocale}'…`
  )

  // Capture each precondition before starting the batch; never refresh and retry a stale target.
  const observed = await db.pool.query<{ document_id: string; revision: string }>(
    `SELECT DISTINCT d.id AS document_id, d.revision
     FROM byline_documents d JOIN byline_document_versions v ON v.document_id = d.id
     WHERE v.is_deleted = false AND ($1::uuid IS NULL OR v.collection_id = $1::uuid)
     ORDER BY d.id`,
    [collectionId ?? null]
  )
  const targets = observed.rows.map((row) => ({
    documentId: row.document_id,
    expectedRevision: documentRevisionFromDatabase(row.revision),
  }))
  const report = await db.reAnchorDocuments({ targets, targetLocale, collectionId, dryRun })

  console.log(
    `${dryRun ? '[dry-run] would re-anchor' : '✓ re-anchored'} ${report.reanchored}/${report.total} document(s) → '${targetLocale}'`
  )
  console.log(`  • already anchored to '${targetLocale}': ${report.alreadyAnchored}`)
  console.log(`  • skipped (incomplete translation): ${report.skippedIncomplete}`)

  if (report.skippedIncomplete > 0) {
    console.log(
      `\nDocuments needing a complete '${targetLocale}' translation before they can be re-anchored:`
    )
    for (const r of report.results) {
      if (r.status === 'skipped-incomplete') {
        console.log(`  - ${r.documentId} (currently anchored to '${r.fromLocale}')`)
      }
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ re-anchor failed:', error)
    process.exit(1)
  })
