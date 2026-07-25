/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  AdminPreferencesRepository,
  AdminUserPreferenceRow,
} from '@byline/admin/admin-preferences'
import { and, eq } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { adminUserPreferences } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

/**
 * MySQL implementation of `AdminPreferencesRepository`. Ported from
 * `packages/db-postgres/src/modules/admin/admin-preferences-repository.ts`.
 *
 * `jsonb` → `json`. pg's upsert merges the JSONB patch per key inside a
 * single `ON CONFLICT DO UPDATE value = value || patch` statement, computed
 * atomically at the database. MySQL's nearest built-in, `JSON_MERGE_PATCH`,
 * implements RFC 7396 merge-patch semantics — which recurse into matching
 * nested *object* values instead of replacing them wholesale — a genuine
 * divergence from Postgres's `||`, which only ever merges top-level keys
 * (confirmed against the Postgres docs for the jsonb concatenation
 * operator, not assumed). `AdminUserPreferenceRow.value` is a
 * `Record<string, unknown>` a caller could one day populate with a nested
 * object, so this doesn't reach for `JSON_MERGE_PATCH` — it computes the
 * merge in JS instead (`{ ...current, ...patch }`, an exact shallow-merge
 * equivalent of `||`), inside a transaction that `SELECT … FOR UPDATE`-locks
 * the target row first, closing the read-then-write race a naive two-step
 * merge would otherwise open (`byline_admin_user_preferences` has exactly
 * one unique key — the composite `(user_id, scope)` primary key — so the
 * lock is unambiguous). `.returning()` has no MySQL equivalent; `created_at`/
 * `updated_at` are captured once as `now` and reused for both the write and
 * the returned row (on first insert; `updated_at` alone on a merge, exactly
 * as pg's own `SET updated_at = now()` does) — no re-`SELECT` needed.
 */
export function createAdminPreferencesRepository(
  db: MySql2Database<typeof schema>
): AdminPreferencesRepository {
  return {
    async get(userId, scope) {
      const [row] = await db
        .select()
        .from(adminUserPreferences)
        .where(and(eq(adminUserPreferences.user_id, userId), eq(adminUserPreferences.scope, scope)))
      return (row as AdminUserPreferenceRow | undefined) ?? null
    },

    async upsert(userId, scope, patch) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(adminUserPreferences)
          .where(
            and(eq(adminUserPreferences.user_id, userId), eq(adminUserPreferences.scope, scope))
          )
          .for('update')

        const now = new Date()
        const merged: Record<string, unknown> = {
          ...(existing?.value as Record<string, unknown> | undefined),
          ...patch,
        }

        if (existing) {
          await tx
            .update(adminUserPreferences)
            .set({ value: merged, updated_at: now })
            .where(
              and(eq(adminUserPreferences.user_id, userId), eq(adminUserPreferences.scope, scope))
            )
          return {
            user_id: userId,
            scope,
            value: merged,
            created_at: existing.created_at,
            updated_at: now,
          } satisfies AdminUserPreferenceRow
        }

        await tx.insert(adminUserPreferences).values({
          user_id: userId,
          scope,
          value: merged,
          created_at: now,
          updated_at: now,
        })
        return {
          user_id: userId,
          scope,
          value: merged,
          created_at: now,
          updated_at: now,
        } satisfies AdminUserPreferenceRow
      })
    },
  }
}
