/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for request-scoped transaction propagation
 * (`withTransaction` — see docs/03-architecture/03-transactions.md).
 *
 * Proves the load-bearing guarantee the audit log depends on: multiple
 * `commands.*` calls wrapped in one `withTransaction` commit or roll back
 * **together**. Every canonical `IDbAdapter` must provide this guarantee
 * (see the interface's own doc comment), so this suite exercises it purely
 * through the adapter contract — `withTransaction` plus
 * `queries.collections.getCollectionByPath` for existence checks — with no
 * adapter-internal handle.
 */

import type { IDbAdapter } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

/**
 * Ported from `packages/db-postgres/src/modules/storage/tests/storage-transactions.test.ts`.
 * The original verified row existence via a raw drizzle `select` against the
 * `collections` schema table; that is replaced here with
 * `queries.collections.getCollectionByPath`, the equivalent check every
 * `IDbAdapter` already exposes on its public contract.
 */
export function transactionsSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter

  const ts = Date.now()
  const createdPaths: string[] = []

  async function collectionExists(path: string): Promise<boolean> {
    const row = await adapter.queries.collections.getCollectionByPath(path)
    return Boolean(row)
  }

  describe('withTransaction propagation + atomicity', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([])
    })

    afterAll(async () => {
      for (const path of createdPaths) {
        try {
          const row = await adapter.queries.collections.getCollectionByPath(path)
          if (row) await adapter.commands.collections.delete(row.id)
        } catch (error) {
          console.error('cleanup failed for', path, error)
        }
      }
    })

    it('commits every command in the boundary together', async () => {
      const a = `tx-commit-a-${ts}`
      const b = `tx-commit-b-${ts}`
      createdPaths.push(a, b)

      await adapter.withTransaction(async () => {
        await adapter.commands.collections.create(a, {
          path: a,
          labels: { singular: 'A', plural: 'As' },
          fields: [{ name: 'title', type: 'text' }],
        })
        await adapter.commands.collections.create(b, {
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
        adapter.withTransaction(async () => {
          // First write succeeds...
          await adapter.commands.collections.create(a, {
            path: a,
            labels: { singular: 'A', plural: 'As' },
            fields: [{ name: 'title', type: 'text' }],
          })
          // ...then the unit of work fails after it. If the first write ran
          // outside the ambient transaction, it would survive this throw.
          throw boom
        })
      ).rejects.toThrow('boom')

      // Atomicity: the successful-looking first write was rolled back with the
      // failing transaction. Neither collection exists.
      expect(await collectionExists(a)).toBe(false)
      expect(await collectionExists(b)).toBe(false)
    })
  })
}
