/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminUserRow } from './repository.js'
import type { AdminUserResponse } from './schemas.js'

/**
 * Shape an `AdminUserRow` into its public `AdminUserResponse` form.
 *
 * The row type from the repository already omits `password_hash`, so
 * this is effectively an identity map — the indirection exists so that
 * if internal fields ever get added to the row (e.g. tenant id,
 * soft-delete timestamp), they are explicitly opted out of the public
 * shape here rather than leaking by default.
 */
export function toAdminUser(row: AdminUserRow): AdminUserResponse {
  return {
    id: row.id,
    email: row.email,
    given_name: row.given_name,
    family_name: row.family_name,
    username: row.username,
    remember_me: row.remember_me,
    last_login: row.last_login,
    last_login_ip: row.last_login_ip,
    failed_login_attempts: row.failed_login_attempts,
    is_super_admin: row.is_super_admin,
    is_enabled: row.is_enabled,
    is_email_verified: row.is_email_verified,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
