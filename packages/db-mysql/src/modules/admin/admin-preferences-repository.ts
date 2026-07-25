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
import { DbErrorCodes, ERR_DATABASE, getLogger } from '@byline/core'
import { and, eq } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { adminUserPreferences } from '../../database/schema/auth.js'
import { classifyError } from '../storage/classify-error.js'
import { affectedRowCount } from '../storage/storage-utils.js'
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
 * The conflict-fallback branch handles the row vanishing out from under it
 * too: if a concurrent delete (e.g. cascading from the owning admin user)
 * removes the row between the failed `INSERT` and the locked `SELECT`,
 * `existing` comes back empty and this inserts fresh rather than merging
 * onto — and reporting success for — a snapshot of a row that no longer
 * exists. The subsequent `UPDATE`'s affected-row count is checked too,
 * defensively, even though the `FOR UPDATE` lock held across the
 * read-modify-write should make a mid-transaction disappearance there
 * unreachable.
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

        if (!existing) {
          // The row that made our INSERT fail is gone by the time we got
          // here — a concurrent delete (e.g. cascading from the owning
          // admin user) raced us between the failed INSERT and this locked
          // read. There is truly no row now, so insert fresh rather than
          // merging onto a snapshot that no longer exists.
          await tx.insert(adminUserPreferences).values({
            user_id: userId,
            scope,
            value: patch,
            created_at: now,
            updated_at: now,
          })
          return {
            user_id: userId,
            scope,
            value: { ...patch },
            created_at: now,
            updated_at: now,
          } satisfies AdminUserPreferenceRow
        }

        const merged: Record<string, unknown> = {
          ...(existing.value as Record<string, unknown>),
          ...patch,
        }

        const result = await tx
          .update(adminUserPreferences)
          .set({ value: merged, updated_at: now })
          .where(
            and(eq(adminUserPreferences.user_id, userId), eq(adminUserPreferences.scope, scope))
          )
        if (affectedRowCount(result) === 0) {
          // Unreachable in practice — `existing` was read via `FOR UPDATE`
          // inside this same transaction, so the row is locked and cannot
          // vanish before the `UPDATE` above. Guarded anyway so a write
          // that didn't happen is never reported as a success.
          throw ERR_DATABASE({
            message: 'admin preferences upsert: locked row vanished before UPDATE',
          }).log(getLogger())
        }

        return {
          user_id: userId,
          scope,
          value: merged,
          created_at: existing.created_at,
          updated_at: now,
        } satisfies AdminUserPreferenceRow
      })
    },
  }
}
