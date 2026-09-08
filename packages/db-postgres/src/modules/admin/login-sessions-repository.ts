/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { LoginSessionsRepository } from '@byline/admin/auth'
import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { adminLoginSessions } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

export function createLoginSessionsRepository(
  db: NodePgDatabase<typeof schema>
): LoginSessionsRepository {
  return {
    async create(input) {
      await db.insert(adminLoginSessions).values(input)
    },
    async findById(id) {
      const [row] = await db.select().from(adminLoginSessions).where(eq(adminLoginSessions.id, id))
      return row ?? null
    },
    async extend(id, expiresAt) {
      await db
        .update(adminLoginSessions)
        .set({ expires_at: expiresAt })
        .where(and(eq(adminLoginSessions.id, id), isNull(adminLoginSessions.revoked_at)))
    },
    async revoke(id, at = new Date()) {
      await db
        .update(adminLoginSessions)
        .set({ revoked_at: at })
        .where(and(eq(adminLoginSessions.id, id), isNull(adminLoginSessions.revoked_at)))
    },
    async revokeAllForUser(adminUserId, at = new Date()) {
      await db
        .update(adminLoginSessions)
        .set({ revoked_at: at })
        .where(
          and(
            eq(adminLoginSessions.admin_user_id, adminUserId),
            isNull(adminLoginSessions.revoked_at)
          )
        )
    },
  }
}
