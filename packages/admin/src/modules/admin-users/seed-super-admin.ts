/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { hashPassword } from '../auth/password.js'
import type { AdminStore } from '../../store.js'

export interface SeedSuperAdminInput {
  email: string
  /** Plaintext — hashed before insert. */
  password: string
  given_name?: string
  family_name?: string
  /** Role machine_name. Defaults to `'super-admin'`. */
  roleMachineName?: string
  /** Role display name. Defaults to `'Super Admin'`. */
  roleName?: string
}

export interface SeedSuperAdminResult {
  userId: string
  roleId: string
  created: {
    user: boolean
    role: boolean
    assignment: boolean
  }
}

/**
 * Idempotently create the super-admin role + user and assign them to each
 * other. Safe to re-run against an existing database — reports what was
 * newly created via the `created` flags so scripts can log meaningfully.
 *
 * This is the only built-in seed we ship for auth. Everything else is
 * configured through the admin UI (or directly via the repositories) once
 * the super-admin is in.
 *
 * The user row has `is_super_admin: true` and `is_enabled: true` set
 * explicitly — the default for `is_enabled` is false so UI-created
 * accounts require deliberate enablement, but the seed always produces a
 * usable account.
 */
export async function seedSuperAdmin(
  store: AdminStore,
  input: SeedSuperAdminInput
): Promise<SeedSuperAdminResult> {
  const roleMachineName = input.roleMachineName ?? 'super-admin'
  const roleName = input.roleName ?? 'Super Admin'

  // 1. Role
  let role = await store.adminRoles.getByMachineName(roleMachineName)
  let roleCreated = false
  if (!role) {
    role = await store.adminRoles.create({
      name: roleName,
      machine_name: roleMachineName,
      description:
        'Built-in role held by the initial super-admin. Individual users also carry the is_super_admin flag.',
      order: 0,
    })
    roleCreated = true
  }

  // 2. User
  let user = await store.adminUsers.getByEmail(input.email)
  let userCreated = false
  if (!user) {
    const passwordHash = await hashPassword(input.password)
    user = await store.adminUsers.create({
      email: input.email,
      password_hash: passwordHash,
      given_name: input.given_name ?? null,
      family_name: input.family_name ?? null,
      is_super_admin: true,
      is_enabled: true,
      is_email_verified: true,
    })
    userCreated = true
  }

  // 3. Assignment (idempotent)
  const existingRoles = await store.adminRoles.listRolesForUser(user.id)
  const alreadyAssigned = existingRoles.some((r) => r.id === role.id)
  if (!alreadyAssigned) {
    await store.adminRoles.assignToUser(role.id, user.id)
  }

  return {
    userId: user.id,
    roleId: role.id,
    created: {
      user: userCreated,
      role: roleCreated,
      assignment: !alreadyAssigned,
    },
  }
}
