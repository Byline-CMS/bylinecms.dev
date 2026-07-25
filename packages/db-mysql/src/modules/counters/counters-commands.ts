/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ICounterCommands } from '@byline/core'
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

/**
 * Table-emulated counters (design spec §3 — "the one real design
 * divergence"). MySQL has no `CREATE SEQUENCE`, so `byline_counter_groups`
 * IS the allocator: `current_value` holds the counter's live state, advanced
 * in place with the classic `LAST_INSERT_ID(expr)` idiom, which makes an
 * atomic `UPDATE`/`INSERT ... ON DUPLICATE KEY UPDATE` return its own new
 * value via a same-connection `SELECT LAST_INSERT_ID()` — no separate
 * `SELECT ... FOR UPDATE` round trip needed.
 *
 * Static (`ensureCounterGroup` + `nextCounterValue`) and runtime-scoped
 * (`nextScopedCounterValue`) counters deliberately share the one
 * `byline_counter_groups` table, keyed by name — see the schema comment on
 * `counterGroups` (`packages/db-mysql/src/database/schema/index.ts`) for why
 * a second `byline_counter_scopes` table (as the plan's implementation note
 * first sketched) cannot honour `ICounterCommands`'s documented contract
 * that a scope self-registered via `nextScopedCounterValue` continues the
 * very same count when subsequently read through `nextCounterValue` — two
 * independently-incrementing tables cannot both be "the same sequence"
 * without every scoped call also writing the static table to keep them in
 * sync, at which point it is one table with extra steps.
 *
 * Every method here takes the raw mysql2 **pool**, not `DBManager` — counters
 * must never run inside the ambient `withTransaction` (a long document-create
 * transaction holding the counter row would serialise every other writer in
 * that group; gaps on rollback are already contractual, see
 * `ICounterCommands.nextCounterValue`'s docstring). `nextCounterValue` and
 * `nextScopedCounterValue` additionally check out a single connection via
 * `pool.getConnection()` for their two-statement bodies — `LAST_INSERT_ID()`
 * is per-connection session state (confirmed live: a second, freshly-opened
 * connection reads it back as `0` regardless of what a sibling connection
 * just set it to), so issuing the two statements through `pool.execute()` /
 * `pool.query()` directly would let the pool hand each one a different
 * physical connection and silently return another session's value.
 */
export class CounterCommands implements ICounterCommands {
  constructor(private pool: Pool) {}

  async ensureCounterGroup(
    groupName: string
  ): Promise<{ groupName: string; sequenceName: string }> {
    if (!groupName || typeof groupName !== 'string') {
      throw new Error(`ensureCounterGroup: groupName must be a non-empty string`)
    }

    // No DB sequence object exists on this dialect — the emulation row's own
    // identity stands in for the sequence name the Postgres adapter reports.
    const sequenceName = `byline_counter_groups:${groupName}`

    // `ON DUPLICATE KEY UPDATE group_name = group_name` is a race-safe no-op
    // on an existing row (confirmed live: reports `ROW_COUNT() = 0` and
    // leaves `current_value` untouched) — unlike Postgres's `CREATE SEQUENCE
    // IF NOT EXISTS`, this single statement has no two-phase check-then-act
    // window for two booting processes to race through, so there is no
    // unique-violation to absorb here.
    await this.pool.execute(
      'INSERT INTO byline_counter_groups (group_name, sequence_name, current_value) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE group_name = group_name',
      [groupName, sequenceName]
    )

    return { groupName, sequenceName }
  }

  async nextCounterValue(groupName: string): Promise<number> {
    if (!groupName || typeof groupName !== 'string') {
      throw new Error(`nextCounterValue: groupName must be a non-empty string`)
    }

    // Never `this.pool.execute()` here — see the class docblock. Both
    // statements below must land on the one checked-out connection.
    const connection = await this.pool.getConnection()
    try {
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE byline_counter_groups SET current_value = LAST_INSERT_ID(current_value + 1) WHERE group_name = ?',
        [groupName]
      )

      // Zero affected rows means the group was never registered — surface
      // that immediately rather than silently seeding it (mirrors pg's
      // "unregistered group is a configuration error" honesty).
      if (result.affectedRows === 0) {
        throw new Error(
          `nextCounterValue: counter group "${groupName}" is not registered. ` +
            `Call ensureCounterGroup at boot before any document create that uses it.`
        )
      }

      const [rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS v')
      const row = rows[0] as { v: number | string } | undefined
      if (row === undefined) {
        throw new Error(
          `nextCounterValue: LAST_INSERT_ID() returned no row for group "${groupName}"`
        )
      }
      return typeof row.v === 'number' ? row.v : Number(row.v)
    } finally {
      connection.release()
    }
  }

  async nextScopedCounterValue(scopeName: string): Promise<number> {
    if (!scopeName || typeof scopeName !== 'string') {
      throw new Error(`nextScopedCounterValue: scopeName must be a non-empty string`)
    }

    const sequenceName = `byline_counter_groups:${scopeName}`

    // One atomic ensure-then-allocate statement: the `VALUES` seed itself
    // wraps `LAST_INSERT_ID(1)`, so the insert path (brand-new scope) also
    // leaves `LAST_INSERT_ID()` reading `1` on this connection — confirmed
    // live, including that a second concurrent insert attempt on the same
    // scope_name correctly falls through to the `ON DUPLICATE KEY UPDATE`
    // branch rather than erroring. Still needs the same-connection
    // discipline as `nextCounterValue` — see the class docblock.
    const connection = await this.pool.getConnection()
    try {
      await connection.execute(
        'INSERT INTO byline_counter_groups (group_name, sequence_name, current_value) ' +
          'VALUES (?, ?, LAST_INSERT_ID(1)) ' +
          'ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)',
        [scopeName, sequenceName]
      )

      const [rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS v')
      const row = rows[0] as { v: number | string } | undefined
      if (row === undefined) {
        throw new Error(
          `nextScopedCounterValue: LAST_INSERT_ID() returned no row for scope "${scopeName}"`
        )
      }
      return typeof row.v === 'number' ? row.v : Number(row.v)
    } finally {
      connection.release()
    }
  }
}

export function createCounterCommands(pool: Pool): ICounterCommands {
  return new CounterCommands(pool)
}
