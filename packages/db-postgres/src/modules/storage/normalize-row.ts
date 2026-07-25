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
 * contract. For pg this is mostly identity (BIGINT `file_size` may arrive as
 * a string, tolerated by the type; numeric/decimal arrives as a string) with
 * one deliberate coercion: `value_date` and `value_timestamp_tz` are turned
 * into real `Date` instances (see `toDateOnly` / `toDate` below) so this
 * adapter matches `@byline/db-mysql`'s temporal shape — see the "converge on
 * Date" ruling this module implements. Mirrors
 * `packages/db-mysql/src/modules/storage/normalize-row.ts`, whose mysql
 * counterpart has to canonicalise far more (tinyint booleans, JSON columns,
 * DATE/DATETIME arriving as strings for a different reason — see that
 * file's docblock).
 */
export function normalizeRow(row: Record<string, unknown>): UnifiedFieldValue {
  return {
    ...row,
    value_date: toDateOnly(row.value_date as string | Date | null | undefined),
    value_timestamp_tz: toDate(row.value_timestamp_tz as string | Date | null | undefined),
  } as unknown as UnifiedFieldValue
}

/**
 * `'2026-01-15'` (Postgres `date` text, no time-of-day component) → a `Date`
 * at **UTC** midnight for that calendar date.
 *
 * A `date` column carries no time zone identity at all — Postgres always
 * renders it as a bare `YYYY-MM-DD` string, confirmed live against
 * `byline_store_datetime.value_date` — so there is no offset to lose and no
 * ambiguity to resolve; UTC midnight is simply the deterministic choice
 * (host-local midnight would make the same stored row shift calendar day
 * across deployments). Mirrors `@byline/db-mysql`'s `toDateOnly`, which
 * carries the full ruling history — see that file. Both adapters now agree.
 */
function toDateOnly(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * A `value_timestamp_tz` UNION ALL cell → a real `Date`.
 *
 * This looks like it should be ambiguous — `storage-store-manifest.ts`'s
 * `pgNullCast()` casts the six store tables that don't own this column to
 * `NULL::timestamp` (no time zone), and `drizzle-orm`'s node-postgres
 * session installs a `getTypeParser` override that returns the driver's raw
 * wire text unparsed for `TIMESTAMPTZ`/`TIMESTAMP`/`DATE` on every query
 * (see that module's docblock, and `packages/core/src/storage/
 * storage-row-types.ts`, for the fuller mechanism). Naively, six
 * `timestamp`-typed NULL branches against one `timestamptz`-typed real
 * branch would sound like the projected column loses its offset.
 *
 * It doesn't. Confirmed live (`byline_store_datetime`, `SET TIME ZONE
 * 'Asia/Bangkok'`, and `pg_cast`): Postgres's set-operation type resolution
 * picks `timestamp with time zone` as the UNION's common type, not
 * `timestamp` — because `timestamp → timestamptz` is registered in
 * `pg_cast` with `castcontext = 'i'` (implicit), so the six `NULL::timestamp`
 * branches are implicitly promoted to `timestamptz` to match the one real
 * branch, rather than the real branch being narrowed down to match them.
 * The driver therefore always receives (and passes through unparsed) text
 * carrying an explicit UTC offset, e.g. `'2024-01-15 03:00:00+00'` under a
 * UTC session or `'2024-01-15 10:00:00+07'` under an `Asia/Bangkok` one for
 * the same stored instant — verified to resolve to the same instant in both
 * cases. `new Date(...)` parses that shape (space-separated, 2-digit or
 * `HH:MM` offset) correctly in this runtime; no manual offset handling is
 * needed or attempted here.
 *
 * Precision note: Postgres stores this column as `timestamptz(6)`
 * (microseconds) but a JS `Date` only holds milliseconds, so coercion
 * truncates sub-millisecond precision. That loss is unavoidable through this
 * API, not a bug in this function.
 */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  return new Date(value)
}
