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
import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { adminUserPreferences } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

/**
 * Postgres implementation of `AdminPreferencesRepository`. The upsert
 * merges the JSONB patch per key (`value || patch`) so partial writes
 * (a page-size change) never wipe sibling keys (a stored sort).
 */
export function createAdminPreferencesRepository(
  db: NodePgDatabase<typeof schema>
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
      const [row] = await db
        .insert(adminUserPreferences)
        .values({ user_id: userId, scope, value: patch })
        .onConflictDoUpdate({
          target: [adminUserPreferences.user_id, adminUserPreferences.scope],
          set: {
            value: sql`${adminUserPreferences.value} || ${JSON.stringify(patch)}::jsonb`,
            updated_at: new Date(),
          },
        })
        .returning()
      if (!row) throw new Error('upsertAdminUserPreference: insert returned no row')
      return row as AdminUserPreferenceRow
    },
  }
}
