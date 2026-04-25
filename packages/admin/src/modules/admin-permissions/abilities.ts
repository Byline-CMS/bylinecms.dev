/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

/**
 * Ability keys for the admin-permissions module.
 *
 * `read` gates the inspector view (Phase 8 in AUTHN-AUTHZ-ANALYSIS.md).
 * `update` will gate the per-role ability editor mounted on the
 * admin-roles role detail page — declared here so the role editor can
 * assert against it once that surface lands. The per-role editor shares
 * the `update` key rather than minting `grant` / `revoke` keys: granting
 * abilities to a role is a single editorial operation from the admin's
 * perspective, and a granular split would force a redundant key on
 * every permission-managing role.
 */
export const ADMIN_PERMISSIONS_ABILITIES = {
  read: 'admin.permissions.read',
  update: 'admin.permissions.update',
} as const

export type AdminPermissionsAbilityKey =
  (typeof ADMIN_PERMISSIONS_ABILITIES)[keyof typeof ADMIN_PERMISSIONS_ABILITIES]

export function registerAdminPermissionsAbilities(registry: AbilityRegistry): void {
  registry.register({
    key: ADMIN_PERMISSIONS_ABILITIES.read,
    label: 'Read admin permissions',
    description: 'View the abilities inspector and per-role ability grants.',
    group: 'admin.permissions',
    source: 'admin',
  })
  registry.register({
    key: ADMIN_PERMISSIONS_ABILITIES.update,
    label: 'Update admin permissions',
    description: "Edit a role's ability grants.",
    group: 'admin.permissions',
    source: 'admin',
  })
}
