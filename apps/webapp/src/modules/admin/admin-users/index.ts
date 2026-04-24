/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-users server fns — thin wrappers over the transport-agnostic
 * commands in `@byline/admin/admin-users`. Each fn resolves the admin
 * request context from session cookies, threads in the lazy-initialised
 * `AdminStore`, and lets the command do the heavy lifting. Re-exports
 * the response types so route loaders can type their loader-data
 * without reaching across package boundaries.
 */

export type {
  AdminUserListOrder,
  AdminUserListResponse,
  AdminUserResponse,
  OkResponse,
} from '@byline/admin/admin-users'

export { type CreateAdminUserInput, createAdminUser } from './create'
export { deleteAdminUser } from './delete'
export { disableAdminUser } from './disable'
export { enableAdminUser } from './enable'
export { getAdminUser } from './get'
export { type ListAdminUsersInput, listAdminUsers } from './list'
export { type SetAdminUserPasswordInput, setAdminUserPassword } from './set-password'
export { type UpdateAdminUserInput, updateAdminUser } from './update'
