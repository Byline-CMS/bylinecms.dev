/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { sql } from 'drizzle-orm'
import { customType, datetime } from 'drizzle-orm/mysql-core'

/**
 * `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin` — canonical UUID text.
 *
 * Every id / FK column in the schema uses this type. `ascii_bin` is a
 * byte-wise (case-sensitive) collation, so id equality comparisons and
 * joins compare bytes rather than applying a case- or accent-insensitive
 * collation — the MySQL analogue of comparing `uuid` values in Postgres,
 * which has no notion of collation for that type at all. UUIDs are
 * app-generated UUIDv7 (the `uuid` package's `v7()`), never DB-generated.
 */
export const uuidChar = customType<{ data: string; driverData: string }>({
  dataType: () => 'char(36) CHARACTER SET ascii COLLATE ascii_bin',
})

/**
 * `varchar(...)` with explicit byte-wise (`ascii_bin`) collation.
 *
 * Used for `byline_documents.order_key` (and `byline_document_relationships
 * .order_key`) so the column sorts the same way JavaScript string
 * comparison does. The fractional-index algorithm in `@byline/core`
 * (`generateKeyBetween`, `generateNKeysBetween`) is designed against
 * byte-wise ordering; MySQL's default collation (`utf8mb4_0900_ai_ci` on
 * this database) is accent- and case-insensitive and disagrees with JS on
 * cases like `'Zz' vs 'a0'` — which causes a refetch after a drag-reorder
 * to "snap" the moved row back to its original position. Mirrors the
 * Postgres adapter's `varcharByteSorted` (`COLLATE "C"`); see
 * `packages/db-postgres/src/database/schema/index.ts`.
 */
export const varcharByteSorted = customType<{
  data: string
  driverData: string
  config: { length: number }
}>({
  dataType: (config) => {
    const len = config?.length ?? 255
    return `varchar(${len}) CHARACTER SET ascii COLLATE ascii_bin`
  },
})

/**
 * Audit-timestamp column shape used across every Byline table.
 * `DATETIME(3)` — millisecond precision; stored and read as UTC by
 * convention (the mysql2 pool is opened with `timezone: 'Z'` so values
 * round-trip without local-timezone reinterpretation). MySQL's `DATETIME`
 * has no timezone-aware storage the way Postgres's `TIMESTAMPTZ` does, so
 * the UTC discipline is enforced entirely at the connection layer rather
 * than the column type.
 *
 * Defined once here so adding a new column to every table — or changing
 * the precision across the schema — is a one-line edit.
 */
const auditTimestamp = (name: string) =>
  datetime(name, { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)

/**
 * Both `created_at` and `updated_at` for tables whose rows are
 * mutated in place (most application tables — users, roles, documents,
 * store rows, paths).
 *
 * Spread into a `mysqlTable` definition:
 *
 *   mysqlTable('byline_admin_users', {
 *     id: uuidChar('id').primaryKey(),
 *     ...timestamps,
 *   })
 */
export const timestamps = {
  created_at: auditTimestamp('created_at'),
  updated_at: auditTimestamp('updated_at'),
}

/**
 * `created_at` only — for tables whose rows are immutable once
 * inserted (junction tables like `byline_admin_role_admin_user`,
 * registry rows like `byline_counter_groups`).
 *
 * Spread into a `mysqlTable` definition the same way as `timestamps`.
 */
export const createdAt = {
  created_at: auditTimestamp('created_at'),
}
