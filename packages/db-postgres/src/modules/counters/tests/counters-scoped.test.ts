/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ICounterCommands } from '@byline/core'
import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { counterGroups } from '../../../database/schema/index.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createCounterCommands } from '../counters-commands.js'
import type * as schema from '../../../database/schema/index.js'

// ---------------------------------------------------------------------------
// Track-and-clean fixtures
// ---------------------------------------------------------------------------
//
// Integration tests share the dev database. Each scope this suite touches
// creates a registry row + a Postgres sequence; track the scope names and
// drop both on teardown so repeated runs start from a clean slate (and so
// monotonicity assertions are not satisfied by a previous run's sequence).

let db: NodePgDatabase<typeof schema>
let counters: ICounterCommands

const trackedScopes = new Set<string>()

async function cleanupScope(scopeName: string): Promise<void> {
  const rows = await db
    .select({ sequence_name: counterGroups.sequence_name })
    .from(counterGroups)
    .where(eq(counterGroups.group_name, scopeName))
    .limit(1)
  const sequenceName = rows[0]?.sequence_name
  await db.delete(counterGroups).where(eq(counterGroups.group_name, scopeName))
  if (sequenceName) {
    await db.execute(sql.raw(`DROP SEQUENCE IF EXISTS "${sequenceName}"`))
  }
}

function scope(name: string): string {
  trackedScopes.add(name)
  return name
}

beforeAll(async () => {
  const setup = setupTestDB()
  db = setup.db
  counters = createCounterCommands(db)
  // Clean any leftovers from a previously aborted run.
  for (const name of trackedScopes) {
    await cleanupScope(name)
  }
})

afterAll(async () => {
  for (const name of trackedScopes) {
    await cleanupScope(name)
  }
  await teardownTestDB()
})

describe('nextScopedCounterValue', () => {
  it('self-registers an unknown scope and allocates from 1', async () => {
    const scopeName = scope('test:doc-a:files')

    const first = await counters.nextScopedCounterValue(scopeName)
    expect(first).toBe(1)

    // The registry row and its backing sequence now exist.
    const rows = await db
      .select({ sequence_name: counterGroups.sequence_name })
      .from(counterGroups)
      .where(eq(counterGroups.group_name, scopeName))
    expect(rows).toHaveLength(1)
  })

  it('is monotonic within a scope and never reuses a value', async () => {
    const scopeName = scope('test:doc-b:files')

    const a = await counters.nextScopedCounterValue(scopeName)
    const b = await counters.nextScopedCounterValue(scopeName)
    const c = await counters.nextScopedCounterValue(scopeName)
    expect([a, b, c]).toEqual([1, 2, 3])
  })

  it('scopes are independent — one scope does not advance another', async () => {
    const scopeA = scope('test:doc-c:files')
    const scopeB = scope('test:doc-d:files')

    await counters.nextScopedCounterValue(scopeA)
    await counters.nextScopedCounterValue(scopeA)
    const bFirst = await counters.nextScopedCounterValue(scopeB)
    expect(bFirst).toBe(1)
  })

  it('interoperates with nextCounterValue once registered (same sequence)', async () => {
    const scopeName = scope('test:doc-e:files')

    const viaScoped = await counters.nextScopedCounterValue(scopeName)
    // After self-registration the static-path allocator sees the group too.
    const viaStatic = await counters.nextCounterValue(scopeName)
    expect(viaStatic).toBe(viaScoped + 1)
  })

  it('rejects an empty scope name', async () => {
    await expect(counters.nextScopedCounterValue('')).rejects.toThrow(
      /scopeName must be a non-empty string/
    )
  })

  it('parallel allocations within one scope yield distinct values', async () => {
    const scopeName = scope('test:doc-f:files')

    const values = await Promise.all(
      Array.from({ length: 8 }, () => counters.nextScopedCounterValue(scopeName))
    )
    const unique = new Set(values)
    expect(unique.size).toBe(8)
    expect(Math.min(...values)).toBe(1)
    expect(Math.max(...values)).toBe(8)
  })
})
