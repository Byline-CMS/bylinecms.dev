/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Guards the concurrency design brief §C calls "the whole task": the
 * two-statement `UPDATE ... SET current_value = LAST_INSERT_ID(current_value
 * + 1)` + `SELECT LAST_INSERT_ID()` body of `nextCounterValue` MUST run on
 * one checked-out connection (`LAST_INSERT_ID()` is per-connection state —
 * confirmed live during Task 11: a fresh connection reads back `0` regardless
 * of what a sibling connection just set). Nothing in the shared
 * `@byline/db-conformance` `countersSuite` exercises this specific risk
 * surface: its only parallel test (`counters.ts:87-98`) is 8-way on
 * `nextScopedCounterValue`, whose body is a single atomic
 * `INSERT ... ON DUPLICATE KEY UPDATE` statement — no same-connection
 * discipline to get wrong, because there is only ever one statement.
 * `nextCounterValue`'s two-statement body is the one method where a refactor
 * could silently swap `connection.execute`/`connection.query` for
 * `pool.execute`/`pool.query` (dropping the checked-out connection and
 * letting the pool hand each statement to a different physical connection)
 * and still pass every other test in this adapter — 280/280 unit, 138/138
 * integration — because the resulting duplicate/zero counter values only
 * show up under real concurrent load, which nothing else in the suite
 * generates against this specific method. This test is that guard, and it
 * belongs here (a MySQL-specific emulation detail — the shared conformance
 * suite exercises `ICounterCommands`' contract behaviour, not this
 * adapter's own connection-checkout implementation).
 *
 * Uses its own dedicated pool (not the shared singleton `test-helper.ts`
 * hands other integration test files in this same worker process — vitest
 * runs this suite with `fileParallelism: false` / `maxWorkers: 1`, so a
 * monkey-patched shared pool would leak into whichever file runs next) so
 * `pool.getConnection` can be instrumented without any cross-file risk.
 */

import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertTestDatabase, resetTestDatabase } from '../../../lib/test-db.js'
import { createCounterCommands } from '../counters-commands.js'

describe('CounterCommands connection discipline under concurrency (mysql, live database)', () => {
  let pool: mysql.Pool
  let counters: ReturnType<typeof createCounterCommands>

  beforeAll(async () => {
    const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
    assertTestDatabase(connectionString)
    await resetTestDatabase(connectionString as string)

    // connectionLimit: 4 mirrors the test harness's own pool sizing
    // (test-helper.ts) — small enough that 20 concurrent nextCounterValue
    // calls genuinely contend for connections, which is the point.
    pool = mysql.createPool({
      uri: connectionString,
      connectionLimit: 4,
      timezone: 'Z',
      decimalNumbers: false,
      charset: 'UTF8MB4_0900_AI_CI',
    })
    counters = createCounterCommands(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('20 parallel nextCounterValue calls on one group yield the expected contiguous set, genuinely contending a 4-connection pool', async () => {
    const groupName = `concurrency-test-${Date.now()}`
    await counters.ensureCounterGroup(groupName)

    // Instrument connection checkout/release to prove the calls genuinely
    // overlapped rather than serialized. Distinctness alone does not prove
    // this: 20 calls run one at a time (each getting its own connection in
    // turn, or even all 20 on the SAME connection sequentially) would also
    // return 20 distinct, contiguous values — the two-statement
    // same-connection defect this test exists to catch only shows up under
    // real overlap, so the test must force and observe that overlap
    // directly rather than infer it from the results.
    let activeConnections = 0
    let maxObservedConcurrency = 0
    const originalGetConnection = pool.getConnection.bind(pool)
    // biome-ignore lint/suspicious/noExplicitAny: instrumenting the pool's
    // own connection lifecycle needs to reach past mysql2/promise's typed
    // surface; scoped to this test and restored in the `finally` below.
    ;(pool as any).getConnection = async (...args: unknown[]) => {
      const conn = await (originalGetConnection as (...a: unknown[]) => Promise<any>)(...args)
      activeConnections++
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConnections)
      const originalRelease = conn.release.bind(conn)
      conn.release = (...releaseArgs: unknown[]) => {
        activeConnections--
        return originalRelease(...releaseArgs)
      }
      return conn
    }

    let results: number[]
    try {
      results = await Promise.all(
        Array.from({ length: 20 }, () => counters.nextCounterValue(groupName))
      )
    } finally {
      pool.getConnection = originalGetConnection
    }

    // Distinct AND the exact expected contiguous set {1..20} — a silently
    // duplicated or zero return (the actual failure mode of a connection-
    // discipline regression, per LAST_INSERT_ID()'s per-connection scoping)
    // fails this, not just a weaker "no two values are equal" check.
    const sorted = [...results].sort((a, b) => a - b)
    expect(new Set(results).size).toBe(20)
    expect(sorted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))

    // Genuine contention, not accidental interleaving: with
    // connectionLimit: 4 and 20 concurrent callers, more than one
    // connection must have been checked out simultaneously at some point.
    // A fully-serialized run — the shape a same-connection-checkout
    // regression's fix-by-coincidence could produce — would never exceed 1
    // here.
    expect(maxObservedConcurrency).toBeGreaterThan(1)
  })
})
