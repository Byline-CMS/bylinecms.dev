/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `AdminPreferencesRepository` — the DB-adapter-facing contract for the
 * `byline_admin_user_preferences` table: a scoped per-user key-value
 * store. One row per (user, scope); `value` is a JSONB object whose
 * shape is owned by the scope's feature (validated at the command
 * layer, not here).
 *
 * Adapters (e.g. `@byline/db-postgres`) implement this interface; the
 * admin-preferences service consumes it via the `AdminStore` bundle.
 */

export interface AdminUserPreferenceRow {
  user_id: string
  scope: string
  value: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

export interface AdminPreferencesRepository {
  /** `null` when the user has no row for the scope. */
  get(userId: string, scope: string): Promise<AdminUserPreferenceRow | null>
  /**
   * Insert-or-merge. On conflict the JSONB `patch` is merged into the
   * stored value **per key** (`value || patch`), so writing
   * `{ page_size }` preserves a previously stored `order`/`desc`.
   * Vid-less — preferences are last-writer-wins by design.
   */
  upsert(
    userId: string,
    scope: string,
    patch: Record<string, unknown>
  ): Promise<AdminUserPreferenceRow>
}
