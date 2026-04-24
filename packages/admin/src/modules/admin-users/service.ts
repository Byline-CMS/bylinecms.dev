/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminAuth } from '@byline/auth'

import { hashPassword } from '../auth/password.js'
import { toAdminUser } from './dto.js'
import {
  ERR_ADMIN_USER_EMAIL_IN_USE,
  ERR_ADMIN_USER_NOT_FOUND,
  ERR_ADMIN_USER_SELF_DELETE,
  ERR_ADMIN_USER_SELF_DISABLE,
} from './errors.js'
import type { AdminUsersRepository } from './repository.js'
import type {
  AdminUserResponse,
  CreateAdminUserRequest,
  DeleteAdminUserRequest,
  DisableAdminUserRequest,
  EnableAdminUserRequest,
  GetAdminUserRequest,
  SetAdminUserPasswordRequest,
  UpdateAdminUserRequest,
} from './schemas.js'

/**
 * Business logic for administering admin users.
 *
 * The service owns three concerns the repository deliberately avoids:
 *
 *   1. **Password hashing.** `hashPassword` from `@byline/admin/auth`
 *      runs here so every write path (create, setPassword, future
 *      password-reset flows) hashes consistently.
 *   2. **Domain invariants.** Email conflict detection on create/update,
 *      self-delete / self-disable prevention — rules the database
 *      cannot enforce on its own.
 *   3. **DTO shaping.** Raw rows are shaped through `toAdminUser` so
 *      the response contract is owned in one place.
 *
 * Commands call service methods after Zod-validating input and asserting
 * abilities; internal callers (seeds, other services) can call service
 * methods directly. Either way, the service is transport-agnostic.
 *
 * Service methods take the acting `AdminAuth` as an explicit first
 * argument when they need it for invariants (self-delete checks). Reads
 * do not need the actor — the ability check at the command boundary is
 * sufficient.
 */
export class AdminUsersService {
  readonly #repo: AdminUsersRepository

  constructor(deps: { repo: AdminUsersRepository }) {
    this.#repo = deps.repo
  }

  async getUser(request: GetAdminUserRequest): Promise<AdminUserResponse> {
    const row = await this.#repo.getById(request.id)
    if (!row) throw ERR_ADMIN_USER_NOT_FOUND()
    return toAdminUser(row)
  }

  async createUser(request: CreateAdminUserRequest): Promise<AdminUserResponse> {
    // Pre-check for email conflict. The unique index on `email` is the
    // ultimate backstop if a race beats this check; the pre-check exists
    // so the common case returns a clean domain-specific error rather
    // than a raw Postgres code.
    const existing = await this.#repo.getByEmail(request.email)
    if (existing) throw ERR_ADMIN_USER_EMAIL_IN_USE()

    const password_hash = await hashPassword(request.password)
    const row = await this.#repo.create({
      email: request.email,
      password_hash,
      given_name: request.given_name ?? null,
      family_name: request.family_name ?? null,
      username: request.username ?? null,
      is_super_admin: request.is_super_admin,
      is_enabled: request.is_enabled,
      is_email_verified: request.is_email_verified,
    })
    return toAdminUser(row)
  }

  async updateUser(request: UpdateAdminUserRequest): Promise<AdminUserResponse> {
    const current = await this.#repo.getById(request.id)
    if (!current) throw ERR_ADMIN_USER_NOT_FOUND()

    // If email is being changed, check that the new address is not taken
    // by another user.
    if (request.patch.email != null && request.patch.email !== current.email) {
      const owner = await this.#repo.getByEmail(request.patch.email)
      if (owner && owner.id !== request.id) throw ERR_ADMIN_USER_EMAIL_IN_USE()
    }

    const row = await this.#repo.update(request.id, request.patch)
    return toAdminUser(row)
  }

  async setPassword(request: SetAdminUserPasswordRequest): Promise<void> {
    const exists = await this.#repo.getById(request.id)
    if (!exists) throw ERR_ADMIN_USER_NOT_FOUND()
    const password_hash = await hashPassword(request.password)
    await this.#repo.setPasswordHash(request.id, password_hash)
  }

  async enableUser(request: EnableAdminUserRequest): Promise<void> {
    const exists = await this.#repo.getById(request.id)
    if (!exists) throw ERR_ADMIN_USER_NOT_FOUND()
    await this.#repo.setEnabled(request.id, true)
  }

  async disableUser(actor: AdminAuth, request: DisableAdminUserRequest): Promise<void> {
    if (actor.id === request.id) throw ERR_ADMIN_USER_SELF_DISABLE()
    const exists = await this.#repo.getById(request.id)
    if (!exists) throw ERR_ADMIN_USER_NOT_FOUND()
    await this.#repo.setEnabled(request.id, false)
  }

  async deleteUser(actor: AdminAuth, request: DeleteAdminUserRequest): Promise<void> {
    if (actor.id === request.id) throw ERR_ADMIN_USER_SELF_DELETE()
    const exists = await this.#repo.getById(request.id)
    if (!exists) throw ERR_ADMIN_USER_NOT_FOUND()
    await this.#repo.delete(request.id)
  }
}
