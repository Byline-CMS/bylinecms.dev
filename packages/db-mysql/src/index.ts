/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import type { PoolConnection as CallbackPoolConnection } from 'mysql2'
import mysql from 'mysql2/promise'

import * as schema from './database/schema/index.js'
import { assertMySqlVersion } from './lib/boot-check.js'
import { DBManagerImpl, TXManagerImpl } from './lib/db-manager.js'
import { createAuditCommands } from './modules/audit/audit-commands.js'
import { createAuditQueries } from './modules/audit/audit-queries.js'
import { createCounterCommands } from './modules/counters/counters-commands.js'
import { classifyError } from './modules/storage/classify-error.js'
import { createCommandBuilders } from './modules/storage/storage-commands.js'
import { createQueryBuilders } from './modules/storage/storage-queries.js'

/**
 * Public return type of `mysqlAdapter`. Extends `IDbAdapter` with concrete
 * Drizzle + mysql2 handles so integrations that need the raw database (the
 * session provider, housekeeping scripts, migration tooling) don't have
 * to construct a second connection pool.
 *
 * Consumers that only need the adapter contract can still annotate as
 * `IDbAdapter` and ignore the extra properties. Mirrors `PgAdapter`
 * (`packages/db-postgres/src/index.ts`).
 */
export interface MySqlAdapter extends IDbAdapter {
  /** The underlying Drizzle instance, typed against the full schema. */
  drizzle: MySql2Database<typeof schema>
  /** The mysql2 connection pool — exposed for housekeeping and teardown. */
  pool: mysql.Pool
}

export const mysqlAdapter = ({
  connectionString,
  collections,
  defaultContentLocale,
  connectionLimit = 20,
}: {
  connectionString: string
  collections: readonly CollectionDefinition[]
  /**
   * The installation's default content locale, sourced from
   * `ServerConfig.i18n.content.defaultLocale`. Used by the storage layer as
   * the **fallback** anchor only: new documents are stamped with it as their
   * `source_locale`, and it is the floor for row-less lookups (findByPath) and
   * for documents whose `source_locale` is not yet backfilled. Per-document
   * reads and writes otherwise re-base onto each document's own `source_locale`
   * (carried on the current-documents views), so changing this value does not
   * re-interpret existing data. See docs/07-internationalization/index.md.
   */
  defaultContentLocale: string
  /**
   * Maximum number of connections in the mysql2 pool. Defaults to 20. Tune
   * via `BYLINE_DB_MYSQL_CONNECTION_LIMIT` in the host app.
   */
  connectionLimit?: number
}): MySqlAdapter => {
  const pool = mysql.createPool({
    uri: connectionString,
    connectionLimit,
    // Every DATETIME column is UTC by convention (spec §2). 'Z' stops
    // mysql2 from reinterpreting stored UTC values against the server's or
    // session's local timezone on the way in and out.
    timezone: 'Z',
    // Keep DECIMAL columns as strings instead of coercing to JS `number`,
    // which loses precision on money/decimal values. The storage layer
    // (Task 9) treats decimal store values as strings end to end, matching
    // the pg adapter's `numeric` handling.
    decimalNumbers: false,
    // Task 10A divergence, found live: mysql2 negotiates
    // `utf8mb4_unicode_ci` as the connection's default collation unless told
    // otherwise — it does NOT inherit the schema/database default
    // (`utf8mb4_0900_ai_ci`, see `database/schema/common.ts`). A typed
    // `CAST(NULL AS CHAR)` expression (the UNION ALL null-cast machinery in
    // `storage-store-manifest.ts`) carries the *connection's* collation, so
    // without this, `getAllFieldValuesForMultipleVersions`'s 7-way UNION ALL
    // fails with `ER_CANT_AGGREGATE_NCOLLATIONS` ("Illegal mix of
    // collations") the moment a CAST'd column and a real schema column with
    // a different collation land in the same UNION output position.
    // Pinning the connection's collation to match the schema fixes it at
    // the source rather than adding a `COLLATE` clause to every cast.
    charset: 'UTF8MB4_0900_AI_CI',
  })

  // `drizzle-orm/mysql2` requires `mode` whenever `schema` is supplied.
  // 'default' matches the pg adapter's un-prefixed-key mode (as opposed to
  // 'planetscale', which changes how relational queries build).
  const db: MySql2Database<typeof schema> = drizzle(pool, {
    schema,
    mode: 'default',
  })

  // Request-scoped transaction propagation (docs/03-architecture/03-transactions.md), mirroring
  // the pg adapter. Exported via ./lib/db-manager.js for Tasks 9-12: command
  // builders land on the DBManager so each `this.db` access resolves to the
  // ambient transaction when a `withTransaction` boundary is open, else the
  // pool.
  const dbManager = new DBManagerImpl({ dbPool: db })
  const txManager = new TXManagerImpl({ db: dbManager })
  const commandBuilders = createCommandBuilders(dbManager, defaultContentLocale)
  // Most reads run on the raw `db` (not the DBManager) — they don't need to
  // join an ambient `withTransaction`. `dbManager` is still threaded through
  // as the 4th argument (matching pg's `storage-queries.ts`) because
  // `DocumentQueries` accepts it as `transactionDb` for the one read that
  // DOES need the ambient transaction: `getDocumentSystemFieldsForUpdate`
  // (Task 10B) takes a `SELECT … FOR UPDATE` lock that must run inside the
  // caller's transaction to serialise concurrent system-field writers —
  // dropping `dbManager` here would silently run that lock outside the
  // transaction and defeat the concurrency guard it exists to provide.
  // `transactionDb` is a required parameter (no default) precisely so this
  // can never be omitted by accident — see the §H ruling in the Task 10B
  // report.
  const queryBuilders = createQueryBuilders(db, collections, defaultContentLocale, dbManager)

  // Counters run on the raw mysql2 `pool` — never `dbManager` — so they never
  // join an ambient `withTransaction`: a long document-create transaction
  // holding the counter row would serialise every other writer in that
  // group (Task 11). Audit appends run on `dbManager` so they DO join the
  // ambient transaction and commit atomically with the mutation they
  // record; audit reads run on the plain `db` (the pool) since they never
  // need to join that transaction. See ./modules/counters/counters-commands.js
  // and ./modules/audit/{audit-commands,audit-queries}.js.
  const counterCommands = createCounterCommands(pool)
  const auditCommands = createAuditCommands(dbManager)
  const auditQueries = createAuditQueries(db)

  // Boot check: run lazily on the pool's first physical connection rather
  // than eagerly here, because `mysqlAdapter` is synchronous (mirroring
  // `pgAdapter`) and cannot await a round trip before returning. mysql2
  // pools open no connections at construction time — the `'connection'`
  // event fires the first time a query actually needs one, which in
  // practice is during `initBylineCore()`'s own boot sequence. A too-old
  // server or MariaDB is a configuration error, not a recoverable runtime
  // condition, so a failed check is rethrown on the next tick to surface as
  // a loud, fail-fast crash instead of a silently swallowed rejection.
  //
  // The `mysql2/promise` typings claim this event hands back a
  // promise-wrapped `PoolConnection`, but at runtime it is the underlying
  // callback-style connection (confirmed against a live server) — calling
  // `.query()` on it directly returns an `EventEmitter`, not a `Promise`.
  // `.promise()` is the callback API's own escape hatch back to the
  // promise wrapper; see https://sidorares.github.io/node-mysql2/docs/documentation/promise-wrapper.
  let versionCheckStarted = false
  pool.on('connection', (connection) => {
    if (versionCheckStarted) return
    versionCheckStarted = true
    const rawConnection = connection as unknown as CallbackPoolConnection
    const promiseConnection = rawConnection.promise()
    assertMySqlVersion(async (sql) => {
      const [rows] = await promiseConnection.query(sql)
      return rows as Array<{ v: string }>
    }).catch((err) => {
      process.nextTick(() => {
        throw err
      })
    })
  })

  return {
    commands: {
      // `commandBuilders.collections` fully implements `ICollectionCommands`
      // (Task 9A) — see `./modules/storage/storage-commands.js`.
      collections: commandBuilders.collections,
      // `commandBuilders.documents` (`DocumentCommands`) fully implements
      // `IDocumentCommands` as of Task 9B — see that class's docblock.
      documents: commandBuilders.documents,
      // `counterCommands` fully implements `ICounterCommands` as of Task 11
      // — see `./modules/counters/counters-commands.js`.
      counters: counterCommands,
      // `auditCommands` fully implements `IAuditCommands` as of Task 11 —
      // see `./modules/audit/audit-commands.js`.
      audit: auditCommands,
    },
    queries: {
      // `queryBuilders.collections` fully implements `ICollectionQueries`
      // (Task 10A) — see `./modules/storage/storage-queries.js`.
      collections: queryBuilders.collections,
      // `queryBuilders.documents` (`DocumentQueries`) fully implements
      // `IDocumentQueries` as of Task 10B — see that class's docblock.
      documents: queryBuilders.documents,
      // `auditQueries` fully implements `IAuditQueries` as of Task 11 — see
      // `./modules/audit/audit-queries.js`.
      audit: auditQueries,
    },
    withTransaction: (fn) => txManager.withTransaction(fn),
    classifyError,
    drizzle: db,
    pool,
  }
}
