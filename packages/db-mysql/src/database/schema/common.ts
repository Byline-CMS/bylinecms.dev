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
 * `varchar(...)` with the `utf8mb4_bin` collation — full `utf8mb4` charset
 * (unlike `uuidChar/varcharByteSorted`'s ascii-only columns, this one must
 * carry arbitrary Unicode), but byte-wise, case- and accent-sensitive
 * comparison instead of the database's default `utf8mb4_0900_ai_ci`.
 *
 * Used for `byline_document_paths.path`. MySQL's default collation is
 * accent- *and* case-insensitive, so `/About` and `/about` collide as the
 * same path on MySQL while remaining two distinct paths on Postgres (whose
 * default collation carries no such folding). The project owner's initial
 * instinct was that MySQL's default might be the *better* semantic for
 * URLs — until testing against a live server showed `ai_ci` also collapses
 * combining marks Byline's slugifier deliberately preserves for non-Latin
 * scripts: `กา` = `ก่า` (a Thai tone mark), `कान` = `कानं` (a Devanagari
 * anusvara), `שלום` = `שָׁלוֹם` (Hebrew niqqud) — see
 * `packages/core/src/utils/slugify.ts`, which folds Latin diacritics but
 * explicitly keeps non-Latin combining marks, because those marks are
 * meaning-bearing in a way a Latin accent mark on a URL slug typically
 * isn't. Two Thai (or Devanagari, or Hebrew) slugs Byline intended as
 * distinct documents would silently collide as one path on MySQL only.
 * Ruling: pin `utf8mb4_bin` so the two adapters agree exactly. This is
 * `path` only — the store *value* columns keep the database's default
 * `ai_ci` collation; the resulting accent-insensitive `LIKE` divergence
 * there was elected deliberately by the plan and stands.
 */
export const varcharCaseSensitive = customType<{
  data: string
  driverData: string
  config: { length: number }
}>({
  dataType: (config) => {
    const len = config?.length ?? 255
    return `varchar(${len}) COLLATE utf8mb4_bin`
  },
})

/**
 * Audit-timestamp column shape used across every Byline table.
 * `DATETIME(6)` — microsecond precision, matching the Postgres adapter's
 * `timestamp(name, { precision: 6, withTimezone: true })` exactly (see
 * `packages/db-postgres/src/database/schema/common.ts`'s `auditTimestamp`).
 * MySQL supports fractional seconds 0–6; picking 6 gives this adapter the
 * same clock resolution as pg rather than a coarser one.
 *
 * This was `fsp: 3` (millisecond) originally, rejected only for
 * `TIMESTAMP`'s 2038 range limit — with no stated rationale for choosing 3
 * over 6. That turned out to matter: at millisecond resolution, two
 * statements issued back-to-back on a fast local connection can land in the
 * same tick and receive an *identical* `CURRENT_TIMESTAMP(3)` value, which
 * is a real correctness gap for anything that orders or windows by these
 * columns (found via `packages/db-conformance`'s audit activity-feed
 * fixture — see docs/10-testing.md and the Task 11 report for the
 * live-server evidence: four rapid statements produced 2 distinct values at
 * fsp 3 versus 4 distinct values at fsp 6). Matching pg's precision closes
 * that gap at the source instead of asking every fixture/consumer to work
 * around a coarser clock.
 *
 * Stored and read as UTC by convention (the mysql2 pool is opened with
 * `timezone: 'Z'` so values round-trip without local-timezone
 * reinterpretation). MySQL's `DATETIME` has no timezone-aware storage the
 * way Postgres's `TIMESTAMPTZ` does, so the UTC discipline is enforced
 * entirely at the connection layer rather than the column type.
 *
 * Defined once here so adding a new column to every table — or changing
 * the precision across the schema — is a one-line edit.
 */
const auditTimestamp = (name: string) =>
  datetime(name, { fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`)

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
