/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for request-scoped transaction propagation
 * (`withTransaction` / DBManager / TXManager — see docs/TRANSACTIONS.md).
 *
 * Proves the load-bearing guarantee the audit log depends on: multiple
 * `commands.*` calls wrapped in one `withTransaction` commit or roll back
 * **together**, with no transaction handle threaded through their signatures.
 * The commands join the ambient transaction purely via the AsyncLocalStorage
 * propagation in DBManager.get().
 */

import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collections } from '../../../database/schema/index.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import type * as schema from '../../../database/schema/index.js'
import type { DBManagerImpl, TXManagerImpl } from '../../../lib/db-manager.js'

let db: NodePgDatabase<typeof schema>
let dbManager: DBManagerImpl
let txManager: TXManagerImpl
let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>

const ts = Date.now()
const createdPaths: string[] = []

async function collectionExists(path: string): Promise<boolean> {
  const rows = await db
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.path, path))
  return rows.length > 0
}

describe('withTransaction propagation + atomicity', () => {
  beforeAll(() => {
    const testDB = setupTestDB([])
    db = testDB.db
    dbManager = testDB.dbManager
    txManager = testDB.txManager
    commandBuilders = testDB.commandBuilders
  })

  afterAll(async () => {
    for (const path of createdPaths) {
      try {
        const rows = await db
          .select({ id: collections.id })
          .from(collections)
          .where(eq(collections.path, path))
        if (rows[0]) await commandBuilders.collections.delete(rows[0].id)
      } catch (error) {
        console.error('cleanup failed for', path, error)
      }
    }
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

  it('commits every command in the boundary together', async () => {
    const a = `tx-commit-a-${ts}`
    const b = `tx-commit-b-${ts}`
    createdPaths.push(a, b)

    await txManager.withTransaction(async () => {
      await commandBuilders.collections.create(a, {
        path: a,
        labels: { singular: 'A', plural: 'As' },
        fields: [{ name: 'title', type: 'text' }],
      })
      await commandBuilders.collections.create(b, {
        path: b,
        labels: { singular: 'B', plural: 'Bs' },
        fields: [{ name: 'title', type: 'text' }],
      })
    })

    expect(await collectionExists(a)).toBe(true)
    expect(await collectionExists(b)).toBe(true)
  })

  it('rolls back every command in the boundary when it throws', async () => {
    const a = `tx-rollback-a-${ts}`
    const b = `tx-rollback-b-${ts}`

    const boom = new Error('boom')
    await expect(
      txManager.withTransaction(async () => {
        // First write succeeds...
        await commandBuilders.collections.create(a, {
          path: a,
          labels: { singular: 'A', plural: 'As' },
          fields: [{ name: 'title', type: 'text' }],
        })
        // ...then the unit of work fails after it. If the first write ran on
        // the pool rather than the ambient tx, it would survive this throw.
        throw boom
      })
    ).rejects.toThrow('boom')

    // Atomicity: the successful-looking first write was rolled back with the
    // failing transaction. Neither collection exists.
    expect(await collectionExists(a)).toBe(false)
    expect(await collectionExists(b)).toBe(false)
  })
})
