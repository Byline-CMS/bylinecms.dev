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

import { getAdminRequestContext } from '@/lib/auth-context'

export interface CurrentAdminUser {
  id: string
  email: string
  given_name: string | null
  family_name: string | null
  is_super_admin: boolean
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
    }
  }
)
