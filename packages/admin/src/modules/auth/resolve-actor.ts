/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth } from '@byline/auth'

import type { AdminStore } from '../../store.js'

/**
 * Build an `AdminAuth` from a user id by reading the admin-users row and
 * collecting the distinct abilities granted through every role the user
 * holds.
 *
 * Returns `null` when the user does not exist or is not enabled — callers
 * interpret a null result as "no actor, sign-in refused". The enablement
 * check lives here (rather than in the session provider) so that any code
 * path resolving an actor from a stored user id — sign-in, token refresh,
 * seeded super-admin context — applies the same gate.
 *
 * Consumes the admin-users and admin-permissions repositories through the
 * `AdminStore` bundle; adapter-agnostic.
 */
export async function resolveActor(
  store: AdminStore,
  adminUserId: string
): Promise<AdminAuth | null> {
  const user = await store.adminUsers.getById(adminUserId)
  if (!user) return null
  if (!user.is_enabled) return null

  const abilities = await store.adminPermissions.listAbilitiesForUser(adminUserId)

  return new AdminAuth({
    id: user.id,
    abilities,
    isSuperAdmin: user.is_super_admin,
  })
}
