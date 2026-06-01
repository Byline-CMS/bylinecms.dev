/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './database/schema/index.js'
import { createCounterCommands } from './modules/counters/counters-commands.js'
import { createCommandBuilders } from './modules/storage/storage-commands.js'
import { createQueryBuilders } from './modules/storage/storage-queries.js'

/**
 * Public return type of `pgAdapter`. Extends `IDbAdapter` with concrete
 * Drizzle + pg handles so integrations that need the raw database (the
 * session provider, housekeeping scripts, migration tooling) don't have
 * to construct a second connection pool.
 *
 * Consumers that only need the adapter contract can still annotate as
 * `IDbAdapter` and ignore the extra properties.
 */
export interface PgAdapter extends IDbAdapter {
  /** The underlying Drizzle instance typed against the full schema. */
  drizzle: NodePgDatabase<typeof schema>
  /** The pg connection pool — exposed for housekeeping and teardown. */
  pool: pg.Pool
  /**
   * One-time maintenance: populate the version-locale availability ledger
   * (`byline_document_version_locales`) for versions written before it
   * existed, so `localeFallback: 'strict'` reads can see pre-existing
   * documents. Idempotent; uses the configured default content locale. Kept
   * off the core `IDbAdapter` contract (no service depends on it) — see
   * docs/CONTENT-LOCALE-RESOLUTION.md.
   */
  backfillVersionLocales(): Promise<{ rowsInserted: number }>
  /**
   * One-time maintenance: stamp `byline_documents.source_locale` for documents
   * created before the column existed, setting NULL rows to the configured
   * default content locale (the anchor they were implicitly authored against).
   * Idempotent; run before the migration that sets the column NOT NULL. Kept
   * off the core `IDbAdapter` contract (no service depends on it) — see
   * docs/DEFAULT-LOCALE-SWITCHING.md.
   */
  backfillSourceLocales(): Promise<{ rowsUpdated: number }>
}

export const pgAdapter = ({
  connectionString,
  collections,
  defaultContentLocale,
  max = 20,
  idleTimeoutMillis = 2000,
  connectionTimeoutMillis = 30000,
}: {
  connectionString: string
  collections: CollectionDefinition[]
  /**
   * The installation's default content locale, sourced from
   * `ServerConfig.i18n.content.defaultLocale`. Used by the storage layer as
   * the **fallback** anchor only: new documents are stamped with it as their
   * `source_locale`, and it is the floor for row-less lookups (findByPath) and
   * for documents whose `source_locale` is not yet backfilled. Per-document
   * reads and writes otherwise re-base onto each document's own `source_locale`
   * (carried on the current-documents views), so changing this value does not
   * re-interpret existing data. See docs/DEFAULT-LOCALE-SWITCHING.md.
   */
  defaultContentLocale: string
  /**
   * Maximum number of clients in the pg connection pool. Defaults to 20.
   * Tune via `BYLINE_DB_POSTGRES_MAX_POOL` in the host app.
   */
  max?: number
  /**
   * Milliseconds an idle client remains in the pool before being closed.
   * Defaults to 2000. Tune via `BYLINE_DB_POSTGRES_IDLE_TIMEOUT_MILLIS`.
   */
  idleTimeoutMillis?: number
  /**
   * Milliseconds to wait for a new connection before erroring. Defaults
   * to 30000 — long enough to absorb cold starts on serverless Postgres
   * providers like Neon. Tune via
   * `BYLINE_DB_POSTGRES_CONNECTION_TIMEOUT_MILLIS`.
   */
  connectionTimeoutMillis?: number
}): PgAdapter => {
  const pool = new pg.Pool({
    connectionString: connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  })

  const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema })

  const commandBuilders = createCommandBuilders(db, defaultContentLocale)
  const queryBuilders = createQueryBuilders(db, collections, defaultContentLocale)
  const counterCommands = createCounterCommands(db)

  return {
    commands: {
      ...commandBuilders,
      counters: counterCommands,
    },
    queries: queryBuilders,
    drizzle: db,
    pool,
    backfillVersionLocales: () => commandBuilders.documents.backfillVersionLocales(),
    backfillSourceLocales: () => commandBuilders.documents.backfillSourceLocales(),
  }
}
