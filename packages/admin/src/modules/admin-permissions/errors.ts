/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Module-local error codes for admin-permissions.
 *
 * `ROLE_NOT_FOUND` covers the editor (and future grant/revoke) paths;
 * `ABILITY_UNREGISTERED` is reserved for the editor too — when a client
 * tries to grant an ability key that no subsystem has registered. The
 * inspector is read-only and never throws either of these.
 */

export const AdminPermissionsErrorCodes = {
  ROLE_NOT_FOUND: 'admin.permissions.roleNotFound',
  ABILITY_UNREGISTERED: 'admin.permissions.abilityUnregistered',
} as const

export type AdminPermissionsErrorCode =
  (typeof AdminPermissionsErrorCodes)[keyof typeof AdminPermissionsErrorCodes]

export interface AdminPermissionsErrorOptions {
  message?: string
  cause?: unknown
}

export class AdminPermissionsError extends Error {
  public readonly code: AdminPermissionsErrorCode

  constructor(code: AdminPermissionsErrorCode, options: { message: string; cause?: unknown }) {
    super(options.message, options.cause != null ? { cause: options.cause } : undefined)
    this.name = 'AdminPermissionsError'
    this.code = code
  }
}

const make =
  (code: AdminPermissionsErrorCode, defaultMessage: string) =>
  (options?: AdminPermissionsErrorOptions): AdminPermissionsError =>
    new AdminPermissionsError(code, {
      message: options?.message ?? defaultMessage,
      cause: options?.cause,
    })

export const ERR_ADMIN_PERMISSIONS_ROLE_NOT_FOUND = make(
  AdminPermissionsErrorCodes.ROLE_NOT_FOUND,
  'admin role not found'
)

export const ERR_ADMIN_PERMISSIONS_ABILITY_UNREGISTERED = make(
  AdminPermissionsErrorCodes.ABILITY_UNREGISTERED,
  'one or more abilities are not registered'
)
