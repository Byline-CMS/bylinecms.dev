/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `AdminPermissionsRepository` — ability grants against roles.
 *
 * Backs the `byline_admin_permissions` table — one row per (role, ability)
 * grant. `setAbilities` is the wholesale-replace operation the role-ability
 * editor in the admin UI will drive; `grantAbility` / `revokeAbility` are
 * the incremental operations for programmatic callers.
 *
 * `listAbilitiesForUser` is the join used by `resolveActor` to build an
 * `AdminAuth` — distinct abilities across every role the user holds.
 *
 * `listRolesForAbility` and `listUsersForAbility` are the inverse joins
 * driving the admin-permissions inspector view (which roles grant a given
 * ability, and which admin users hold those roles transitively).
 */

export interface AdminPermissionsRepository {
  /** Grant an ability to a role. Idempotent via the unique constraint. */
  grantAbility(roleId: string, ability: string): Promise<void>
  revokeAbility(roleId: string, ability: string): Promise<void>
  listAbilities(roleId: string): Promise<string[]>
  /** Replace the ability set for a role wholesale. Runs inside a transaction. */
  setAbilities(roleId: string, abilities: readonly string[]): Promise<void>
  /**
   * Distinct abilities granted to a user via every role they hold. Used by
   * `resolveActor()` to build the ability set on an `AdminAuth`.
   */
  listAbilitiesForUser(userId: string): Promise<string[]>
  /**
   * Role ids that grant the given ability. Used by the inspector to render
   * the per-ability "granted by these roles" list.
   */
  listRolesForAbility(ability: string): Promise<string[]>
  /**
   * Distinct admin user ids that hold a role granting the given ability.
   * Single-query join through `byline_admin_role_admin_user` — preferred
   * over chaining `listRolesForAbility` + `listUsersForRole` so the
   * inspector stays O(1) queries per ability.
   */
  listUsersForAbility(ability: string): Promise<string[]>
}
