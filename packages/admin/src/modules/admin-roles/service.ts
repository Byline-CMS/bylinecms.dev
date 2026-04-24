/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { toAdminRole } from './dto.js'
import { ERR_ADMIN_ROLE_MACHINE_NAME_IN_USE, ERR_ADMIN_ROLE_NOT_FOUND } from './errors.js'
import type { AdminRolesRepository } from './repository.js'
import type {
  AdminRoleListResponse,
  AdminRoleResponse,
  CreateAdminRoleRequest,
  DeleteAdminRoleRequest,
  GetAdminRoleRequest,
  ReorderAdminRolesRequest,
  UpdateAdminRoleRequest,
} from './schemas.js'

/**
 * Business logic for administering admin roles.
 *
 * Owns three concerns the repository deliberately avoids:
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
 *
 * Roles do not need a self-target invariant the way users do
 * (no "self-delete" concept), so service methods are actor-agnostic and
 * the ability check at the command boundary is the only authorisation.
 */
export class AdminRolesService {
  readonly #repo: AdminRolesRepository

  constructor(deps: { repo: AdminRolesRepository }) {
    this.#repo = deps.repo
  }

  async listRoles(): Promise<AdminRoleListResponse> {
    const rows = await this.#repo.list()
    return { roles: rows.map(toAdminRole) }
  }

  async getRole(request: GetAdminRoleRequest): Promise<AdminRoleResponse> {
    const row = await this.#repo.getById(request.id)
    if (!row) throw ERR_ADMIN_ROLE_NOT_FOUND()
    return toAdminRole(row)
  }

  async createRole(request: CreateAdminRoleRequest): Promise<AdminRoleResponse> {
    // Pre-check for machine_name conflict so the common case returns a
    // domain-specific error rather than the raw unique-violation code.
    const existing = await this.#repo.getByMachineName(request.machine_name)
    if (existing) throw ERR_ADMIN_ROLE_MACHINE_NAME_IN_USE()

    const row = await this.#repo.create({
      name: request.name,
      machine_name: request.machine_name,
      description: request.description ?? null,
      order: request.order,
    })
    return toAdminRole(row)
  }

  async updateRole(request: UpdateAdminRoleRequest): Promise<AdminRoleResponse> {
    const current = await this.#repo.getById(request.id)
    if (!current) throw ERR_ADMIN_ROLE_NOT_FOUND()
    const row = await this.#repo.update(request.id, request.vid, request.patch)
    return toAdminRole(row)
  }

  async deleteRole(request: DeleteAdminRoleRequest): Promise<void> {
    const exists = await this.#repo.getById(request.id)
    if (!exists) throw ERR_ADMIN_ROLE_NOT_FOUND()
    await this.#repo.delete(request.id, request.vid)
  }

  async reorderRoles(request: ReorderAdminRolesRequest): Promise<void> {
    await this.#repo.reorder(request.ids)
  }
}
