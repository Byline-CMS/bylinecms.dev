/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { UnifiedFieldValue } from '@byline/core'

import { toDate } from './storage-utils.js'

/**
 * Canonicalise a raw UNION ALL driver row to the shared `UnifiedFieldValue`
 * contract before it reaches `extractFlattenedFieldValue`. Mirrors
 * `packages/db-postgres/src/modules/storage/normalize-row.ts`, whose pg
 * counterpart is an identity cast — the mysql2 driver needs real
 * canonicalisation, verified against a live MySQL 9.7.1 server rather than
 * assumed (mysql2's declared types are a hypothesis, not fact — see
 * `src/index.ts`'s boot-check comment for the prior instance of this on
 * this program):
 *
 *   - `TINYINT(1)` → `boolean`. mysql2 returns a JS `number` (`0`/`1`) for
 *     `TINYINT(1)` columns selected through a raw query, not a `boolean` —
 *     confirmed live. Only the three `UnifiedFieldValue` columns backed by a
 *     `boolean()` column need the coercion: `boolean_value` (the boolean
 *     store's own value), `thumbnail_generated` (file store), and
 *     `cascade_delete` (relation store).
 *   - `DECIMAL` stays a **string** — confirmed live with the pool's
 *     `decimalNumbers: false` option (`src/index.ts`), which must not be
 *     undone; MySQL/JS float coercion would lose precision on money/decimal
 *     values, matching the pg adapter's `numeric` handling.
 *   - `JSON` columns arrive already parsed by the driver — confirmed live
 *     (an inserted JS object round-trips as an object, not a JSON string) —
 *     so this function must not re-`JSON.parse` them.
 *   - `DATE`/`DATETIME` → **string**, not `Date` — the opposite of what an
 *     earlier version of this comment claimed. `drizzle-orm`'s mysql2
 *     driver installs its own `typeCast` on every raw `db.execute(sql\`...\`)`
 *     call (this UNION ALL query has no schema-typed `fields` mapper, so it
 *     always takes that path) that unconditionally calls `field.string()`
 *     for `TIMESTAMP`/`DATETIME`/`DATE` columns, overriding whatever the
 *     pool's own `timezone` option would otherwise do — confirmed live:
 *     `value_date` (a `datetimeStore.date_type === 'date'` row) comes back
 *     as `'2026-01-15'`; `value_timestamp_tz` (`date_type === 'datetime'`)
 *     comes back as `'2026-01-15 10:30:00.123000'`. Both reach
 *     `restoreFieldSetData` (`@byline/core`) and become the runtime value
 *     of a document's `date`/`datetime` field, so an un-coerced string here
 *     was a real, user-facing defect — not just an internal-tooling one —
 *     caught by no existing test because none exercised a `date`/`datetime`
 *     field type through this UNION ALL path. `toDate` (shared,
 *     `storage-utils.js`) and `toDateOnly` below fix it.
 */
export function normalizeRow(row: Record<string, unknown>): UnifiedFieldValue {
  return {
    ...row,
    boolean_value: normalizeTinyIntBoolean(row.boolean_value),
    thumbnail_generated: normalizeTinyIntBoolean(row.thumbnail_generated),
    cascade_delete: normalizeTinyIntBoolean(row.cascade_delete),
    value_date: toDateOnly(row.value_date as string | null | undefined),
    value_timestamp_tz: toDate(row.value_timestamp_tz as string | null | undefined),
  } as unknown as UnifiedFieldValue
}

/**
 * `'2026-01-15'` (MySQL `DATE` text, no time-of-day component) → a `Date`
 * at **UTC** midnight for that calendar date.
 *
 * This is an elected divergence from node-postgres, not a parity claim — an
 * earlier version of this docblock claimed UTC midnight matches
 * node-postgres's own default parser for a `date` column. It doesn't.
 * node-postgres's default `date` parser is `postgres-date` (see its
 * `index.js:16-17`, whose own comment reads "Force YYYY-MM-DD dates to be
 * parsed as local time") — that mismatch is the reason the UTC-vs-local
 * question was raised in the first place. It's moot in practice, though:
 * pg's `normalize-row.ts` bypasses `postgres-date` entirely (drizzle-orm's
 * node-postgres session installs an identity `getTypeParser` for `DATE`, so
 * that default parser never runs on this read path), and as of task 13b
 * pg's own `toDateOnly` anchors at UTC midnight too, for the same
 * determinism reason: host-local midnight would make the same stored `date`
 * value materialise as a different calendar day depending on which host
 * served it.
 *
 * **Ruling (project owner, task 13b): settled.** Both adapters return a
 * `Date` at UTC midnight for `date` fields — verified together, via the
 * shared `@byline/db-conformance` `field-types.ts` fixtures, under both
 * `TZ=UTC` and `TZ=Asia/Bangkok`. This is no longer provisional.
 */
function toDateOnly(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * `TINYINT(1)` → `boolean`, tolerant of the value already being a real
 * boolean (a row assembled in-process rather than round-tripped through the
 * driver) or `null`/`undefined` (column absent for this row's field type —
 * only one value column is ever populated per UNION ALL row).
 */
function normalizeTinyIntBoolean(value: unknown): boolean | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value
  return value !== 0
}
