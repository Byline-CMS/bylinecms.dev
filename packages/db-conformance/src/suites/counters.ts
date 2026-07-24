/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { IDbAdapter } from '@byline/core'
import { beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

/**
 * Ported from `packages/db-postgres/src/modules/counters/tests/counters-scoped.test.ts`.
 * Asserts contract semantics only — monotonic-per-scope allocation, scope
 * independence, and self-registration — through `ICounterCommands`
 * (`nextScopedCounterValue` / `nextCounterValue`). The original's first test
 * additionally inspected the `counterGroups` registry table directly (via a
 * raw drizzle `select` against Postgres schema) to prove the scope had been
 * self-registered; that assertion is replaced here with an equivalent
 * contract-level proof — `nextCounterValue` on the same scope name only
 * succeeds once the scope is registered, so a successful call proves
 * registration without inspecting any catalog or adapter-internal table.
 * No assertion is weakened: both versions prove the same fact, "the scope
 * is now registered."
 */
export function countersSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter

  const ts = Date.now()
  const scope = (name: string): string => `${name}-${ts}`

  describe('counters', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([])
    })

    describe('nextScopedCounterValue', () => {
      it('self-registers an unknown scope and allocates from 1', async () => {
        const scopeName = scope('test:doc-a:files')

        const first = await adapter.commands.counters.nextScopedCounterValue(scopeName)
        expect(first).toBe(1)

        // The scope is now registered — nextCounterValue succeeds instead of
        // throwing "not registered", and continues the same sequence.
        await expect(adapter.commands.counters.nextCounterValue(scopeName)).resolves.toBe(2)
      })

      it('is monotonic within a scope and never reuses a value', async () => {
        const scopeName = scope('test:doc-b:files')

        const a = await adapter.commands.counters.nextScopedCounterValue(scopeName)
        const b = await adapter.commands.counters.nextScopedCounterValue(scopeName)
        const c = await adapter.commands.counters.nextScopedCounterValue(scopeName)
        expect([a, b, c]).toEqual([1, 2, 3])
      })

      it('scopes are independent — one scope does not advance another', async () => {
        const scopeA = scope('test:doc-c:files')
        const scopeB = scope('test:doc-d:files')

        await adapter.commands.counters.nextScopedCounterValue(scopeA)
        await adapter.commands.counters.nextScopedCounterValue(scopeA)
        const bFirst = await adapter.commands.counters.nextScopedCounterValue(scopeB)
        expect(bFirst).toBe(1)
      })

      it('interoperates with nextCounterValue once registered (same sequence)', async () => {
        const scopeName = scope('test:doc-e:files')

        const viaScoped = await adapter.commands.counters.nextScopedCounterValue(scopeName)
        // After self-registration the static-path allocator sees the group too.
        const viaStatic = await adapter.commands.counters.nextCounterValue(scopeName)
        expect(viaStatic).toBe(viaScoped + 1)
      })

      it('rejects an empty scope name', async () => {
        await expect(adapter.commands.counters.nextScopedCounterValue('')).rejects.toThrow(
          /scopeName must be a non-empty string/
        )
      })

      it('parallel allocations within one scope yield distinct values', async () => {
        const scopeName = scope('test:doc-f:files')

        const values = await Promise.all(
          Array.from({ length: 8 }, () =>
            adapter.commands.counters.nextScopedCounterValue(scopeName)
          )
        )
        const unique = new Set(values)
        expect(unique.size).toBe(8)
        expect(Math.min(...values)).toBe(1)
        expect(Math.max(...values)).toBe(8)
      })
    })
  })
}
