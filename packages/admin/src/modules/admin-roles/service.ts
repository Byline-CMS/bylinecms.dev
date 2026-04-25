/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { toAdminRole } from './dto.js'
import {
  ERR_ADMIN_ROLE_MACHINE_NAME_IN_USE,
  ERR_ADMIN_ROLE_NOT_FOUND,
  ERR_ADMIN_ROLE_USER_NOT_FOUND,
} from './errors.js'
import type { AdminStore } from '../../store.js'
import type {
  AdminRoleListResponse,
  AdminRoleResponse,
  CreateAdminRoleRequest,
  DeleteAdminRoleRequest,
  GetAdminRoleRequest,
  GetRolesForUserRequest,
  ReorderAdminRolesRequest,
  SetRolesForUserRequest,
  UpdateAdminRoleRequest,
  UserRolesResponse,
} from './schemas.js'

/**
 * Business logic for administering admin roles.
 *
 * Owns four concerns the repository deliberately avoids:
 *
 *   1. **Domain invariants.** `machine_name` uniqueness pre-check on
 *      create — the unique index is the ultimate backstop, but the
 *      pre-check produces a clean domain error rather than a raw
 *      Postgres code.
 *   2. **DTO shaping.** Raw rows are shaped through `toAdminRole` so
 *      the response contract is owned in one place.
 *   3. **Optimistic-concurrency plumbing.** The repo gates writes on
 *      `expectedVid`; the service threads it from the validated request
 *      shape. Version conflicts surface as
 *      `AdminRolesError(VERSION_CONFLICT)` from the adapter; the service
 *      does not catch them.
 *   4. **Cross-table validation.** The user-roles editor validates the
 *      user and every referenced role exists before mutating the join
 *      table — clean errors over raw FK violations.
 *
 * Roles do not need a self-target invariant the way users do
 * (no "self-delete" concept), so role-CRUD service methods are
 * actor-agnostic and the ability check at the command boundary is the
 * only authorisation.
 */
export class AdminRolesService {
  readonly #store: AdminStore

  constructor(deps: { store: AdminStore }) {
    this.#store = deps.store
  }

  async listRoles(): Promise<AdminRoleListResponse> {
    const rows = await this.#store.adminRoles.list()
    return { roles: rows.map(toAdminRole) }
  }

  async getRole(request: GetAdminRoleRequest): Promise<AdminRoleResponse> {
    const row = await this.#store.adminRoles.getById(request.id)
    if (!row) throw ERR_ADMIN_ROLE_NOT_FOUND()
    return toAdminRole(row)
  }

  async createRole(request: CreateAdminRoleRequest): Promise<AdminRoleResponse> {
    // Pre-check for machine_name conflict so the common case returns a
    // domain-specific error rather than the raw unique-violation code.
    const existing = await this.#store.adminRoles.getByMachineName(request.machine_name)
    if (existing) throw ERR_ADMIN_ROLE_MACHINE_NAME_IN_USE()

    const row = await this.#store.adminRoles.create({
      name: request.name,
      machine_name: request.machine_name,
      description: request.description ?? null,
      order: request.order,
    })
    return toAdminRole(row)
  }

  async updateRole(request: UpdateAdminRoleRequest): Promise<AdminRoleResponse> {
    const current = await this.#store.adminRoles.getById(request.id)
    if (!current) throw ERR_ADMIN_ROLE_NOT_FOUND()
    const row = await this.#store.adminRoles.update(request.id, request.vid, request.patch)
    return toAdminRole(row)
  }

  async deleteRole(request: DeleteAdminRoleRequest): Promise<void> {
    const exists = await this.#store.adminRoles.getById(request.id)
    if (!exists) throw ERR_ADMIN_ROLE_NOT_FOUND()
    await this.#store.adminRoles.delete(request.id, request.vid)
  }

  async reorderRoles(request: ReorderAdminRolesRequest): Promise<void> {
    await this.#store.adminRoles.reorder(request.ids)
  }

  async getRolesForUser(request: GetRolesForUserRequest): Promise<UserRolesResponse> {
    const user = await this.#store.adminUsers.getById(request.userId)
    if (!user) throw ERR_ADMIN_ROLE_USER_NOT_FOUND()
    const rows = await this.#store.adminRoles.listRolesForUser(request.userId)
    return { userId: request.userId, roles: rows.map(toAdminRole) }
  }

  async setRolesForUser(request: SetRolesForUserRequest): Promise<UserRolesResponse> {
    const user = await this.#store.adminUsers.getById(request.userId)
    if (!user) throw ERR_ADMIN_ROLE_USER_NOT_FOUND()

    // Validate every referenced role exists. N round-trips, but role
    // assignment payloads are small by design (typically < 10 roles)
    // and surfacing a clean `notFound` beats a raw FK violation.
    if (request.roleIds.length > 0) {
      const found = await Promise.all(
        request.roleIds.map((id) => this.#store.adminRoles.getById(id))
      )
      const missing = request.roleIds.filter((_, i) => found[i] == null)
      if (missing.length > 0) {
        throw ERR_ADMIN_ROLE_NOT_FOUND({
          message: `One or more referenced roles do not exist: ${missing.join(', ')}`,
        })
      }
    }

    await this.#store.adminRoles.setRolesForUser(request.userId, request.roleIds)
    // Return the freshly stored set, shaped — saves the editor a second
    // round-trip and guards against any normalisation the repo might apply.
    const stored = await this.#store.adminRoles.listRolesForUser(request.userId)
    return { userId: request.userId, roles: stored.map(toAdminRole) }
  }
}
