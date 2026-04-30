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

export type { UserRolesResponse } from '@byline/admin/admin-roles'
export type {
  AdminUserListOrder,
  AdminUserListResponse,
  AdminUserResponse,
  OkResponse,
} from '@byline/admin/admin-users'

export { type CreateAdminUserInput, createAdminUser } from './server/create'
export { deleteAdminUser } from './server/delete'
export { disableAdminUser } from './server/disable'
export { enableAdminUser } from './server/enable'
export { getAdminUser } from './server/get'
export { getUserRoles } from './server/get-user-roles'
export { type ListAdminUsersInput, listAdminUsers } from './server/list'
export { type SetAdminUserPasswordInput, setAdminUserPassword } from './server/set-password'
export { type SetUserRolesInput, setUserRoles } from './server/set-user-roles'
export { type UpdateAdminUserInput, updateAdminUser } from './server/update'
