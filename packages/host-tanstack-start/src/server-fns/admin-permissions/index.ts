/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-permissions server fns — thin wrappers over the transport-
 * agnostic commands in `@byline/admin/admin-permissions`. Each fn
 * resolves the admin request context from session cookies and threads
 * in both the lazy-initialised `AdminStore` and the shared
 * `AbilityRegistry` from `bylineCore().abilities`.
 *
 * Phase 1 (this commit) ships the read-only inspector: list registered
 * abilities and resolve who holds a given ability. Phase B will add
 * `getRoleAbilities` / `setRoleAbilities` for the per-role editor that
 * mounts on the admin-roles role detail page.
 */

export type {
  AbilityDescriptorResponse,
  AbilityGroupResponse,
  AbilityHolderRole,
  AbilityHolderUser,
  GetRoleAbilitiesResponse,
  ListRegisteredAbilitiesResponse,
  SetRoleAbilitiesResponse,
  WhoHasAbilityResponse,
} from '@byline/admin/admin-permissions'

export { getRoleAbilities } from './get-role-abilities'
export { listRegisteredAbilities } from './list-registered'
export { type SetRoleAbilitiesInput, setRoleAbilities } from './set-role-abilities'
export { whoHasAbility } from './who-has'
