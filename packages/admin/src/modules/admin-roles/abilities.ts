/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

/**
 * Ability keys for the admin-roles module.
 *
 * Reorder is intentionally **rolled into `update`** — same trust level
 * (mutating role identity), and splitting it would force a redundant
 * `reorder` permission alongside `update` for every role-managing role.
 *
 * Per-role ability grants are managed by the sibling
 * `@byline/admin/admin-permissions` module and have their own ability
 * keys there.
 */
export const ADMIN_ROLES_ABILITIES = {
  read: 'admin.roles.read',
  create: 'admin.roles.create',
  update: 'admin.roles.update',
  delete: 'admin.roles.delete',
} as const

export type AdminRolesAbilityKey =
  (typeof ADMIN_ROLES_ABILITIES)[keyof typeof ADMIN_ROLES_ABILITIES]

/**
 * Register every admin-roles ability with the framework's `AbilityRegistry`.
 * Called from `registerAdminAbilities(registry)` at package level, which
 * the webapp wires into `initBylineCore()`.
 */
export function registerAdminRolesAbilities(registry: AbilityRegistry): void {
  registry.register({
    key: ADMIN_ROLES_ABILITIES.read,
    label: 'Read admin roles',
    group: 'admin.roles',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_ROLES_ABILITIES.create,
    label: 'Create admin roles',
    group: 'admin.roles',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_ROLES_ABILITIES.update,
    label: 'Update or reorder admin roles',
    group: 'admin.roles',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_ROLES_ABILITIES.delete,
    label: 'Delete admin roles',
    group: 'admin.roles',
    source: 'admin',
  })
}
