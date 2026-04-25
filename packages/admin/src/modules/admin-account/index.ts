/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-account` — self-service surfaces for the currently
 * signed-in admin user.
 *
 * Distinct from `@byline/admin/admin-users` in two ways:
 *
 *   1. The actor IS the target. Commands take no `id` field — the
 *      target is sourced from `actor.id` on the authenticated
 *      `RequestContext`. There is no way at the command surface to
 *      ask "operate on someone else."
 *   2. There is no ability gate. The other admin modules use
 *      `assertAdminActor(context, ability)`; this module uses
 *      `requireAdminActor(context)` — authn-only. "Anyone may change
 *      their own password" is the policy.
 *
 * Reuses `AdminUsersRepository` from `@byline/admin/admin-users` rather
 * than introducing a parallel repo — the table is the same and the
 * narrower self-service surface is structural rather than physical.
 *
 * Active-session listing / revocation is intentionally not included
 * yet — that depends on `RefreshTokensRepository` semantics and a
 * "sign out everywhere on password change" follow-up.
 */

export {
  changeAccountPasswordCommand,
  getAccountCommand,
  updateAccountCommand,
} from './commands.js'
export {
  AdminAccountError,
  type AdminAccountErrorCode,
  AdminAccountErrorCodes,
  ERR_ADMIN_ACCOUNT_INVALID_CURRENT_PASSWORD,
  ERR_ADMIN_ACCOUNT_NOT_FOUND,
} from './errors.js'
export {
  accountResponseSchema,
  changeAccountPasswordRequestSchema,
  getAccountRequestSchema,
  okResponseSchema,
  updateAccountRequestSchema,
} from './schemas.js'
export { AdminAccountService } from './service.js'
export type { AdminAccountCommandDeps } from './commands.js'
export type {
  AccountResponse,
  ChangeAccountPasswordRequest,
  GetAccountRequest,
  OkResponse,
  UpdateAccountRequest,
} from './schemas.js'
