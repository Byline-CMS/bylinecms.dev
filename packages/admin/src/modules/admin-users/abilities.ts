/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

/**
 * Ability keys for the admin-users module.
 *
 * Dot-notation rather than Modulus' colon-notation — keeps one consistent
 * hierarchy across the whole platform alongside `collections.<path>.<verb>`
 * from core.
 *
 * `changePassword` is split out from `update` deliberately: setting
 * someone else's password is a higher-trust operation than editing their
 * profile fields, and the role editor UI benefits from naming it
 * explicitly. A role can grant `update` without implicitly granting
 * `changePassword`.
 *
 * Self-service (changing *own* password, email, etc.) does **not** use
 * any of these keys. That flow lives in the separate `account` module
 * where the actor is the target by definition; the `admin.users.*` keys
 * are strictly for administering other admin users.
 */
export const ADMIN_USERS_ABILITIES = {
  read: 'admin.users.read',
  create: 'admin.users.create',
  update: 'admin.users.update',
  delete: 'admin.users.delete',
  changePassword: 'admin.users.changePassword',
} as const

export type AdminUsersAbilityKey =
  (typeof ADMIN_USERS_ABILITIES)[keyof typeof ADMIN_USERS_ABILITIES]

/**
 * Register every admin-users ability with the framework's `AbilityRegistry`.
 * Called from `registerAdminAbilities(registry)` at package level, which
 * the webapp wires into `initBylineCore()`.
 */
export function registerAdminUsersAbilities(registry: AbilityRegistry): void {
  registry.register({
    key: ADMIN_USERS_ABILITIES.read,
    label: 'Read admin users',
    group: 'admin.users',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_USERS_ABILITIES.create,
    label: 'Create admin users',
    group: 'admin.users',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_USERS_ABILITIES.update,
    label: 'Update admin users',
    group: 'admin.users',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_USERS_ABILITIES.delete,
    label: 'Delete admin users',
    group: 'admin.users',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_USERS_ABILITIES.changePassword,
    label: "Change an admin user's password",
    group: 'admin.users',
    source: 'admin',
  })
}
