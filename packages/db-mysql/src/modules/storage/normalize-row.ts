/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { UnifiedFieldValue } from '@byline/core'

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
 *   - `DATETIME(3)` → `Date`, confirmed live with the pool's `timezone: 'Z'`
 *     option, millisecond precision intact.
 */
export function normalizeRow(row: Record<string, unknown>): UnifiedFieldValue {
  return {
    ...row,
    boolean_value: normalizeTinyIntBoolean(row.boolean_value),
    thumbnail_generated: normalizeTinyIntBoolean(row.thumbnail_generated),
    cascade_delete: normalizeTinyIntBoolean(row.cascade_delete),
  } as unknown as UnifiedFieldValue
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
