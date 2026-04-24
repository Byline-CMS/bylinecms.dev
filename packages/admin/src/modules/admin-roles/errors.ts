/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Module-local error codes for admin-roles.
 *
 * Mirrors the `code + factory` shape used by `AdminUsersError`. Codes
 * are dot-prefixed (`admin.roles.*`) so they sort alongside the matching
 * ability keys in logs and admin UI messages.
 */

export const AdminRolesErrorCodes = {
  NOT_FOUND: 'admin.roles.notFound',
  MACHINE_NAME_IN_USE: 'admin.roles.machineNameInUse',
  VERSION_CONFLICT: 'admin.roles.versionConflict',
} as const

export type AdminRolesErrorCode = (typeof AdminRolesErrorCodes)[keyof typeof AdminRolesErrorCodes]

export interface AdminRolesErrorOptions {
  message?: string
  cause?: unknown
}

export class AdminRolesError extends Error {
  public readonly code: AdminRolesErrorCode

  constructor(code: AdminRolesErrorCode, options: { message: string; cause?: unknown }) {
    super(options.message, options.cause != null ? { cause: options.cause } : undefined)
    this.name = 'AdminRolesError'
    this.code = code
  }
}

const make =
  (code: AdminRolesErrorCode, defaultMessage: string) =>
  (options?: AdminRolesErrorOptions): AdminRolesError =>
    new AdminRolesError(code, {
      message: options?.message ?? defaultMessage,
      cause: options?.cause,
    })

/** The referenced admin role id does not exist. */
export const ERR_ADMIN_ROLE_NOT_FOUND = make(AdminRolesErrorCodes.NOT_FOUND, 'admin role not found')

/** Creating a role conflicts with an existing `machine_name`. */
export const ERR_ADMIN_ROLE_MACHINE_NAME_IN_USE = make(
  AdminRolesErrorCodes.MACHINE_NAME_IN_USE,
  'machine name already in use'
)

/**
 * The stored `vid` does not match the client-supplied `expectedVid` —
 * the caller is holding a stale version of the row. Typical admin-UI
 * response is to reload the edit form with the current values.
 */
export const ERR_ADMIN_ROLE_VERSION_CONFLICT = make(
  AdminRolesErrorCodes.VERSION_CONFLICT,
  'admin role has been modified elsewhere — please reload and try again'
)
