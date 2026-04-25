/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Module-local error codes for admin-account self-service.
 *
 * Same `code + factory` shape as the other admin modules. The codes are
 * prefixed `admin.account.*` so they sort alongside any future
 * `admin.account` ability keys (today there are none — self-service is
 * gated only by "you must be authenticated and you can only act on
 * yourself") and so transport layers can branch on them distinctly
 * from `admin.users.*`. Note that `admin.users.versionConflict` and
 * `admin.users.emailInUse` are also reachable here because the service
 * delegates to `AdminUsersRepository.update` / `setPasswordHash`; both
 * are deliberately surfaced unmodified so the UI sees a single error
 * code per condition.
 */

export const AdminAccountErrorCodes = {
  NOT_FOUND: 'admin.account.notFound',
  INVALID_CURRENT_PASSWORD: 'admin.account.invalidCurrentPassword',
} as const

export type AdminAccountErrorCode =
  (typeof AdminAccountErrorCodes)[keyof typeof AdminAccountErrorCodes]

export interface AdminAccountErrorOptions {
  message?: string
  cause?: unknown
}

export class AdminAccountError extends Error {
  public readonly code: AdminAccountErrorCode

  constructor(code: AdminAccountErrorCode, options: { message: string; cause?: unknown }) {
    super(options.message, options.cause != null ? { cause: options.cause } : undefined)
    this.name = 'AdminAccountError'
    this.code = code
  }
}

const make =
  (code: AdminAccountErrorCode, defaultMessage: string) =>
  (options?: AdminAccountErrorOptions): AdminAccountError =>
    new AdminAccountError(code, {
      message: options?.message ?? defaultMessage,
      cause: options?.cause,
    })

/**
 * The actor's admin-user id no longer resolves to a row. Typically
 * means the session refers to a user that has been deleted out of band
 * — the transport handler should clear cookies and redirect to
 * sign-in.
 */
export const ERR_ADMIN_ACCOUNT_NOT_FOUND = make(
  AdminAccountErrorCodes.NOT_FOUND,
  'admin account not found'
)

/**
 * The supplied current password did not verify against the stored hash.
 * Returned for the change-password flow — message is intentionally
 * generic so it can be surfaced verbatim to end users without leaking
 * timing or existence signals.
 */
export const ERR_ADMIN_ACCOUNT_INVALID_CURRENT_PASSWORD = make(
  AdminAccountErrorCodes.INVALID_CURRENT_PASSWORD,
  'current password is incorrect'
)
