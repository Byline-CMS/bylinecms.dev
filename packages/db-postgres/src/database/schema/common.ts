/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { timestamp } from 'drizzle-orm/pg-core'

/**
 * Audit-timestamp column shape used across every Byline table.
 * `TIMESTAMPTZ` with microsecond precision; stored in UTC, converted
 * to/from the session timezone automatically.
 *
 * Defined once here so adding a new column to every table — or
 * changing the precision/timezone behaviour across the schema — is a
 * one-line edit.
 */
const auditTimestamp = (name: string) =>
  timestamp(name, { precision: 6, withTimezone: true }).notNull().defaultNow()

/**
 * Both `created_at` and `updated_at` for tables whose rows are
 * mutated in place (most application tables — users, roles, documents,
 * store rows, paths).
 *
 * Spread into a `pgTable` definition:
 *
 *   pgTable('byline_admin_users', {
 *     id: uuid('id').primaryKey(),
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
 * append-only relationship rows like `byline_document_relationships`,
 * registry rows like `byline_counter_groups`).
 *
 * Spread into a `pgTable` definition the same way as `timestamps`.
 */
export const createdAt = {
  created_at: auditTimestamp('created_at'),
}
