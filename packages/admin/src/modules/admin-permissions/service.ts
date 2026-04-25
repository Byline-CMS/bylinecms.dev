/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

import { toAbilityDescriptor } from './dto.js'
import type { AdminStore } from '../../store.js'
import type {
  ListRegisteredAbilitiesResponse,
  WhoHasAbilityRequest,
  WhoHasAbilityResponse,
} from './schemas.js'

/**
 * Read-only inspector service for admin-permissions.
 *
 * Two responsibilities:
 *
 *   1. **Enumerate registered abilities.** Pure registry read — no DB
 *      access. The registry is populated at `initBylineCore()` time
 *      by collection auto-registration plus subsystem registrars
 *      (`registerAdminAbilities`).
 *   2. **Resolve the who-has matrix.** For a given ability key, list
 *      the roles that grant it and the distinct admin users
 *      transitively holding it. Backed by two single-query joins on
 *      the permissions repository, then resolved against the roles
 *      and users repositories so the inspector can render names
 *      without further round-trips.
 *
 * The editor surface (`getRoleAbilities` / `setRoleAbilities`) is
 * deliberately not on this service yet — it lands with Phase B and
 * will live alongside these methods.
 */
export class AdminPermissionsService {
  readonly #store: AdminStore
  readonly #abilities: AbilityRegistry

  constructor(deps: { store: AdminStore; abilities: AbilityRegistry }) {
    this.#store = deps.store
    this.#abilities = deps.abilities
  }

  listRegisteredAbilities(): ListRegisteredAbilitiesResponse {
    const flat = this.#abilities.list().map(toAbilityDescriptor)
    // Re-bucket from the same shaped descriptors so flat and groups
    // stay byte-identical apart from grouping. Iteration order matches
    // registration order — the registry's `byGroup` already preserves
    // insertion order.
    const grouped = this.#abilities.byGroup()
    const groups = Array.from(grouped.entries(), ([group, abilities]) => ({
      group,
      abilities: abilities.map(toAbilityDescriptor),
    }))
    return {
      abilities: flat,
      groups,
      total: flat.length,
    }
  }

  async whoHasAbility(request: WhoHasAbilityRequest): Promise<WhoHasAbilityResponse> {
    // Run the two inverse joins in parallel — they read the same table
    // through different join paths but neither blocks the other.
    const [roleIds, userIds] = await Promise.all([
      this.#store.adminPermissions.listRolesForAbility(request.ability),
      this.#store.adminPermissions.listUsersForAbility(request.ability),
    ])

    // Resolve role + user metadata in parallel batches. We accept the
    // N round-trips here because admin role and user counts are small
    // by design; if they grow we add `getByIds(ids[])` repo methods
    // later.
    const [roles, users] = await Promise.all([
      Promise.all(roleIds.map((id) => this.#store.adminRoles.getById(id))),
      Promise.all(userIds.map((id) => this.#store.adminUsers.getById(id))),
    ])

    return {
      ability: request.ability,
      roles: roles
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map((r) => ({ id: r.id, name: r.name, machine_name: r.machine_name })),
      users: users
        .filter((u): u is NonNullable<typeof u> => u != null)
        .map((u) => ({
          id: u.id,
          email: u.email,
          given_name: u.given_name,
          family_name: u.family_name,
        })),
    }
  }
}
