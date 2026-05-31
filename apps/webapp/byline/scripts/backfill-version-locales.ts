/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * One-time maintenance: populate the version-locale availability ledger
 * (`byline_document_version_locales`) for document versions written before
 * the ledger existed. After this runs, `localeFallback: 'strict'` reads can
 * see pre-existing documents; new writes keep the ledger current on their own
 * (createDocumentVersion step 6).
 *
 * Idempotent — safe to re-run. Uses the installation's configured default
 * content locale (resolved from byline/i18n.ts via the server config).
 *
 *   cd apps/webapp && pnpm tsx --env-file=.env byline/scripts/backfill-version-locales.ts
 *
 * See docs/CONTENT-LOCALE-RESOLUTION.md.
 */

import '../load-env.js'
import '../server.config.js'

import { getServerConfig } from '@byline/core'
import type { PgAdapter } from '@byline/db-postgres'

async function run() {
  // `backfillVersionLocales` is a Postgres-adapter housekeeping method (off
  // the core `IDbAdapter` contract), so annotate the registered adapter as
  // `PgAdapter` — the documented pattern for scripts that need raw handles.
  const db = getServerConfig().db as PgAdapter
  const { rowsInserted } = await db.backfillVersionLocales()
  console.log(
    `✓ version-locale ledger backfilled — ${rowsInserted} (version, locale) row(s) inserted`
  )
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ version-locale backfill failed:', error)
    process.exit(1)
  })
