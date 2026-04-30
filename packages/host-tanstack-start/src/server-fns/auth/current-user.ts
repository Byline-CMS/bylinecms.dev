/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin profile lookup for the authenticated request.
 *
 * Thin wrapper that resolves the `AdminAuth` via `getAdminRequestContext()`
 * (which handles verify + lazy refresh + cookie rewrites), then fetches the
 * admin user's profile row so the UI can render "signed in as X" without
 * embedding identity metadata in the JWT itself.
 *
 * Throws `ERR_UNAUTHENTICATED` through `getAdminRequestContext` when there
 * is no valid session — callers treat that as "redirect to sign-in".
 */

import { createServerFn } from '@tanstack/react-start'

import { getServerConfig } from '@byline/core'
import type { PgAdapter } from '@byline/db-postgres'
import { createAdminUsersRepository } from '@byline/db-postgres/admin'

import { getAdminRequestContext } from '../../auth/auth-context.js'

export interface CurrentAdminUser {
  id: string
  email: string
  given_name: string | null
  family_name: string | null
  is_super_admin: boolean
  /**
   * Flat ability set resolved from the actor's role grants. Sent to the
   * client so the admin shell can render cosmetic ability cues (hide
   * Users / Roles / Permissions menu items, disable buttons, etc.). The
   * real enforcement boundary is server-side (`assertActorCanPerform` /
   * `assertAdminActor`) — UI cues are an affordance, never a security
   * guarantee.
   *
   * Empty for a non-super-admin who happens to hold zero abilities.
   * Super-admins also receive an empty array here; the `is_super_admin`
   * flag is what callers should branch on for the bypass.
   */
  abilities: string[]
}

export const getCurrentAdminUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CurrentAdminUser> => {
    const { actor } = await getAdminRequestContext()
    if (!actor) {
      // getAdminRequestContext always returns an AdminAuth on success; the
      // null branch is compile-time impossible here but satisfies the type.
      throw new Error('unexpected null actor after getAdminRequestContext')
    }

    const db = (getServerConfig().db as PgAdapter).drizzle
    const users = createAdminUsersRepository(db)
    const row = await users.getById(actor.id)
    if (!row) {
      // Session resolved to an admin id that no longer exists — force the
      // caller back through sign-in rather than return partial data.
      throw new Error('admin user not found for current session')
    }

    return {
      id: row.id,
      email: row.email,
      given_name: row.given_name,
      family_name: row.family_name,
      is_super_admin: row.is_super_admin,
      abilities: Array.from(actor.abilities),
    }
  }
)
