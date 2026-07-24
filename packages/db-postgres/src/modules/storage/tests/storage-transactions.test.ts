/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Postgres-specific residual of the `withTransaction` propagation coverage.
 *
 * The behavioural half of this file — "commits every command in the
 * boundary together" / "rolls back every command in the boundary when it
 * throws" — ported verbatim to `@byline/db-conformance`'s `transactions`
 * suite (`packages/db-conformance/src/suites/transactions.ts`), now run via
 * `packages/db-postgres/tests/conformance.integration.test.ts`.
 *
 * This one test stays behind: it asserts on `DBManager.get()`'s *identity*
 * (the ambient executor equals the raw Drizzle handle outside a transaction
 * boundary and a different handle inside one) — an adapter-internal
 * implementation detail with no equivalent on the `IDbAdapter` contract, so
 * it cannot be expressed through `hooks` alone.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import type * as schema from '../../../database/schema/index.js'
import type { DBManagerImpl, TXManagerImpl } from '../../../lib/db-manager.js'

let db: NodePgDatabase<typeof schema>
let dbManager: DBManagerImpl
let txManager: TXManagerImpl

describe('withTransaction propagation (Postgres DBManager identity)', () => {
  beforeAll(() => {
    const testDB = setupTestDB([])
    db = testDB.db
    dbManager = testDB.dbManager
    txManager = testDB.txManager
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  it('get() returns the pool outside a transaction and the tx inside it', async () => {
    // Outside any boundary, the executor is the pool itself.
    expect(dbManager.get()).toBe(db)

    let insideExecutor: unknown
    await txManager.withTransaction(async () => {
      insideExecutor = dbManager.get()
    })

    // Inside the boundary it is the ambient transaction — a different handle.
    expect(insideExecutor).not.toBe(db)
  })
})
