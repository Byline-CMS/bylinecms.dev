/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth } from '@byline/auth'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  bylineAdminPermissions,
  bylineAdminRoleAdminUser,
  bylineAdminUsers,
} from '../database/schema/auth.js'
import type * as schema from '../database/schema/index.js'

/**
 * Build an `AdminAuth` from a user id by joining
 * `byline_admin_users` → `byline_admin_role_admin_user` →
 * `byline_admin_permissions` and collecting the distinct abilities granted
 * through every role the user holds.
 *
 * Returns `null` when the user does not exist or is not enabled — callers
 * interpret a null result as "no actor, sign-in refused". The enablement
 * check lives here (rather than in the session provider) so that any code
 * path resolving an actor from a stored user id — sign-in, token refresh,
 * seeded super-admin context — applies the same gate.
 *
 * Used by the session provider's `resolveActor()` method (Phase 3) and by
 * tests that need an `AdminAuth` for a seeded user.
 */
export async function resolveActor(
  db: NodePgDatabase<typeof schema>,
  adminUserId: string
): Promise<AdminAuth | null> {
  const [user] = await db
    .select({
      id: bylineAdminUsers.id,
      is_super_admin: bylineAdminUsers.is_super_admin,
      is_enabled: bylineAdminUsers.is_enabled,
    })
    .from(bylineAdminUsers)
    .where(eq(bylineAdminUsers.id, adminUserId))

  if (!user) return null
  if (!user.is_enabled) return null

  // Pull the distinct abilities across all roles held by this user.
  const abilityRows = await db
    .selectDistinct({ ability: bylineAdminPermissions.ability })
    .from(bylineAdminPermissions)
    .innerJoin(
      bylineAdminRoleAdminUser,
      eq(bylineAdminRoleAdminUser.admin_role_id, bylineAdminPermissions.admin_role_id)
    )
    .where(eq(bylineAdminRoleAdminUser.admin_user_id, adminUserId))

  return new AdminAuth({
    id: user.id,
    abilities: abilityRows.map((r) => r.ability),
    isSuperAdmin: user.is_super_admin,
  })
}
