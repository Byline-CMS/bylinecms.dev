/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { toAdminUser } from '../admin-users/dto.js'
import { ERR_ADMIN_USER_EMAIL_IN_USE } from '../admin-users/errors.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import {
  ERR_ADMIN_ACCOUNT_INVALID_CURRENT_PASSWORD,
  ERR_ADMIN_ACCOUNT_NOT_FOUND,
} from './errors.js'
import type { AdminUsersRepository } from '../admin-users/repository.js'
import type {
  AccountResponse,
  ChangeAccountPasswordRequest,
  UpdateAccountRequest,
} from './schemas.js'

/**
 * Self-service business logic for the currently signed-in admin user.
 *
 * Reuses `AdminUsersRepository` rather than introducing a parallel
 * repository — the underlying table is the same, and self-service is
 * just a narrower surface over it. The narrowing is structural:
 *
 *   - Every method takes `actorId` (sourced server-side from the
 *     authenticated `RequestContext`) and uses it as the target id.
 *     Callers cannot supply a target id; commands look it up from
 *     `actor.id` and pass it in.
 *   - `updateAccount` excludes `is_super_admin`, `is_enabled`, and
 *     `is_email_verified` from the writable surface. The schema
 *     already strips them, but the service signature reinforces it.
 *   - `changePassword` verifies the *current* password before swapping
 *     in the new hash. A hijacked session cannot use this flow to lock
 *     out the legitimate owner.
 *
 * Note on session revocation: changing a password here does **not**
 * currently revoke other refresh tokens — existing access tokens stay
 * valid until their 15-minute expiry, and other refresh tokens remain
 * useable. A "sign out everywhere on password change" follow-up should
 * call `RefreshTokensRepository.revokeAllExcept(adminUserId, currentJti)`
 * once that lands.
 */
export class AdminAccountService {
  readonly #repo: AdminUsersRepository

  constructor(deps: { repo: AdminUsersRepository }) {
    this.#repo = deps.repo
  }

  async getAccount(actorId: string): Promise<AccountResponse> {
    const row = await this.#repo.getById(actorId)
    if (!row) throw ERR_ADMIN_ACCOUNT_NOT_FOUND()
    return toAdminUser(row)
  }

  async updateAccount(actorId: string, request: UpdateAccountRequest): Promise<AccountResponse> {
    const current = await this.#repo.getById(actorId)
    if (!current) throw ERR_ADMIN_ACCOUNT_NOT_FOUND()

    if (request.patch.email != null && request.patch.email !== current.email) {
      const owner = await this.#repo.getByEmail(request.patch.email)
      if (owner && owner.id !== actorId) throw ERR_ADMIN_USER_EMAIL_IN_USE()
    }

    const row = await this.#repo.update(actorId, request.vid, request.patch)
    return toAdminUser(row)
  }

  async changePassword(
    actorId: string,
    request: ChangeAccountPasswordRequest
  ): Promise<AccountResponse> {
    // Pull the row *with* the password hash so we can verify the
    // supplied current password before persisting a new one. The
    // sign-in-shaped row is treated as ephemeral here — the hash
    // string is never propagated outside this method.
    const withHash = await this.#repo.getByIdForSignIn(actorId)
    if (!withHash) throw ERR_ADMIN_ACCOUNT_NOT_FOUND()

    const ok = await verifyPassword(request.currentPassword, withHash.password_hash)
    if (!ok) throw ERR_ADMIN_ACCOUNT_INVALID_CURRENT_PASSWORD()

    const newHash = await hashPassword(request.newPassword)
    const row = await this.#repo.setPasswordHash(actorId, request.vid, newHash)
    return toAdminUser(row)
  }
}
