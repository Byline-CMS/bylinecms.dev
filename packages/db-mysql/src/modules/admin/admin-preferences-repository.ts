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
import { DbErrorCodes } from '@byline/core'
import { and, eq } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { adminUserPreferences } from '../../database/schema/auth.js'
import { classifyError } from '../storage/classify-error.js'
import type * as schema from '../../database/schema/index.js'

/**
 * MySQL implementation of `AdminPreferencesRepository`. Ported from
 * `packages/db-postgres/src/modules/admin/admin-preferences-repository.ts`.
 *
 * `jsonb` → `json`. pg's upsert merges the JSONB patch per key inside a
 * single `ON CONFLICT DO UPDATE value = value || patch` statement, computed
 * atomically at the database. MySQL's nearest built-in, `JSON_MERGE_PATCH`,
 * implements RFC 7396 merge-patch semantics — which recurse into matching
 * nested *object* values instead of replacing them wholesale. Confirmed
 * live, not assumed: `JSON_MERGE_PATCH('{"filters":{"status":"draft",
 * "author":"ada"}}', '{"filters":{"status":"published"}}')` returns
 * `{"filters":{"author":"ada","status":"published"}}` — it keeps `author`.
 * Postgres's `||` on the same two documents returns `{"filters":
 * {"status":"published"}}` — it replaces the nested `filters` object
 * wholesale, discarding `author`. `AdminUserPreferenceRow.value` is a
 * `Record<string, unknown>` a caller could one day populate with a nested
 * object, so this doesn't reach for `JSON_MERGE_PATCH` — it computes the
 * merge in JS instead (`{ ...current, ...patch }`), an exact shallow-merge
 * equivalent of `||` that matches pg's actual (not RFC 7396) semantics.
 *
 * Race safety: rather than a `SELECT` (locked or not) followed by a
 * conditional `INSERT`/`UPDATE` — which leaves a window on the
 * *first-ever* write for a (user, scope) pair, since two concurrent
 * transactions can each observe "no row yet" before either commits — this
 * tries the `INSERT` first. `byline_admin_user_preferences` has exactly one
 * unique key, the composite `(user_id, scope)` primary key, so the SQL
 * engine itself is the single arbiter of "does this row already exist":
 * the loser of a genuine race gets `ER_DUP_ENTRY` back atomically and falls
 * through to a `SELECT … FOR UPDATE` + merge + `UPDATE`, run inside a
 * transaction so the lock is held across the read-modify-write. A
 * duplicate-key error is only treated as "row exists, merge" when
 * `classifyError` confirms it's the `PRIMARY` key specifically (verified
 * live: a composite-PK collision on this table reports `for key
 * '<table>.PRIMARY'`) — any other error (e.g. the `fk_admin_user_
 * preferences_user_id` foreign key rejecting an unknown `userId`) rethrows
 * unchanged rather than being misread as a pre-existing row.
 *
 * `.returning()` has no MySQL equivalent; `created_at`/`updated_at` are
 * captured once as `now` and reused for both the write and the returned
 * row — no re-`SELECT` needed.
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
      const insertNow = new Date()
      try {
        await db.insert(adminUserPreferences).values({
          user_id: userId,
          scope,
          value: patch,
          created_at: insertNow,
          updated_at: insertNow,
        })
        return {
          user_id: userId,
          scope,
          value: { ...patch },
          created_at: insertNow,
          updated_at: insertNow,
        } satisfies AdminUserPreferenceRow
      } catch (err) {
        const classification = classifyError(err)
        const isExistingRow =
          classification.code === DbErrorCodes.UNIQUE_VIOLATION &&
          classification.constraint === 'PRIMARY'
        if (!isExistingRow) throw err
      }

      // A row already exists for (userId, scope) — lock it, merge in JS, and
      // write the merge back. Locked inside a transaction so a second
      // concurrent upsert blocks on this row rather than racing it.
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
          // `existing` is expected present (the failed INSERT above proved a
          // row exists) — the `?? now` fallback only guards the
          // vanishingly unlikely window where it was deleted between the
          // failed INSERT and this locked read.
          created_at: existing?.created_at ?? now,
          updated_at: now,
        } satisfies AdminUserPreferenceRow
      })
    },
  }
}
