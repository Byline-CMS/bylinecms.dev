/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Module-local error codes for admin-users.
 *
 * Follows the same `code + factory` shape used by `AuthError` in
 * `@byline/auth`, but with its own class so consumers can distinguish
 * admin-users-specific failures from generic auth failures (e.g. to
 * translate `EMAIL_IN_USE` into a 409 at a transport boundary while
 * `FORBIDDEN` maps to 403).
 *
 * The codes are intentionally prefixed — `admin.users.*` — so they sort
 * alongside the matching ability keys in logs and admin UI messages.
 */

export const AdminUsersErrorCodes = {
  NOT_FOUND: 'admin.users.notFound',
  EMAIL_IN_USE: 'admin.users.emailInUse',
  SELF_DELETE_FORBIDDEN: 'admin.users.selfDeleteForbidden',
  SELF_DISABLE_FORBIDDEN: 'admin.users.selfDisableForbidden',
  VERSION_CONFLICT: 'admin.users.versionConflict',
} as const

export type AdminUsersErrorCode = (typeof AdminUsersErrorCodes)[keyof typeof AdminUsersErrorCodes]

export interface AdminUsersErrorOptions {
  message?: string
  cause?: unknown
}

export class AdminUsersError extends Error {
  public readonly code: AdminUsersErrorCode

  constructor(code: AdminUsersErrorCode, options: { message: string; cause?: unknown }) {
    super(options.message, options.cause != null ? { cause: options.cause } : undefined)
    this.name = 'AdminUsersError'
    this.code = code
  }
}

const make =
  (code: AdminUsersErrorCode, defaultMessage: string) =>
  (options?: AdminUsersErrorOptions): AdminUsersError =>
    new AdminUsersError(code, {
      message: options?.message ?? defaultMessage,
      cause: options?.cause,
    })

/** The referenced admin user id does not exist. */
export const ERR_ADMIN_USER_NOT_FOUND = make(AdminUsersErrorCodes.NOT_FOUND, 'admin user not found')

/** Creating or updating an admin user conflicts with an existing email. */
export const ERR_ADMIN_USER_EMAIL_IN_USE = make(
  AdminUsersErrorCodes.EMAIL_IN_USE,
  'email already in use'
)

/** The actor attempted to delete their own admin-user row. */
export const ERR_ADMIN_USER_SELF_DELETE = make(
  AdminUsersErrorCodes.SELF_DELETE_FORBIDDEN,
  'cannot delete your own admin account'
)

/** The actor attempted to disable their own admin-user row. */
export const ERR_ADMIN_USER_SELF_DISABLE = make(
  AdminUsersErrorCodes.SELF_DISABLE_FORBIDDEN,
  'cannot disable your own admin account'
)

/**
 * The stored `vid` does not match the client-supplied `expectedVid` —
 * the caller is holding a stale version of the row. Typical admin-UI
 * response is to reload the edit form with the current values.
 */
export const ERR_ADMIN_USER_VERSION_CONFLICT = make(
  AdminUsersErrorCodes.VERSION_CONFLICT,
  'admin user has been modified elsewhere — please reload and try again'
)
