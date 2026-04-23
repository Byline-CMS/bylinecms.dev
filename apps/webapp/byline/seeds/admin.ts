/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Super-admin bootstrap seed.
 *
 * Idempotent. Reads credentials from env (`BYLINE_SUPERADMIN_EMAIL`,
 * `BYLINE_SUPERADMIN_PASSWORD`) and calls the built-in
 * `seedSuperAdmin` helper from `@byline/db-postgres/auth` against the
 * application's single connection pool.
 *
 * The admin account it produces:
 *   - `is_super_admin: true`  — bypasses every ability check
 *   - `is_enabled: true`       — ready to sign in immediately
 *   - `is_email_verified: true` — skip the verification gate for bootstrap
 *
 * In any non-dev deployment: change the credentials in env, run the seed
 * once, then immediately change the password from inside the admin UI.
 */

import { seedSuperAdmin } from '@byline/db-postgres/auth'

import { bylineCore } from '../../byline.server.config.js'

export async function seedAdmin() {
  const email = process.env.BYLINE_SUPERADMIN_EMAIL
  const password = process.env.BYLINE_SUPERADMIN_PASSWORD

  if (!email || !password) {
    console.warn(
      'Skipping admin seed: BYLINE_SUPERADMIN_EMAIL and BYLINE_SUPERADMIN_PASSWORD ' +
        'must both be set (see .env.example).'
    )
    return
  }

  // `bylineCore.db` is typed as IDbAdapter at this boundary; the concrete
  // pgAdapter return augments it with the raw drizzle handle.
  const db = (
    bylineCore.db as typeof bylineCore.db & {
      drizzle: Parameters<typeof seedSuperAdmin>[0]
    }
  ).drizzle

  const result = await seedSuperAdmin(db, { email, password })

  const parts: string[] = []
  if (result.created.role) parts.push('role')
  if (result.created.user) parts.push('user')
  if (result.created.assignment) parts.push('assignment')
  if (parts.length === 0) {
    console.log(`Super-admin already present (${email}) — no changes.`)
  } else {
    console.log(`Super-admin seed: created ${parts.join(', ')} for ${email}.`)
  }
}
