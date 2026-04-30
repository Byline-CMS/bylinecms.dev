/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-roles server fns — thin wrappers over the transport-agnostic
 * commands in `@byline/admin/admin-roles`. Each fn resolves the admin
 * request context from session cookies, threads in the lazy-initialised
 * `AdminStore`, and lets the command do the heavy lifting. Re-exports
 * the response types so route loaders can type their loader-data
 * without reaching across package boundaries.
 */

export type { AdminRoleListResponse, AdminRoleResponse } from '@byline/admin/admin-roles'

export { type CreateAdminRoleInput, createAdminRole } from './server/create'
export { deleteAdminRole } from './server/delete'
export { getAdminRole } from './server/get'
export { listAdminRoles } from './server/list'
export { reorderAdminRoles } from './server/reorder'
export { type UpdateAdminRoleInput, updateAdminRole } from './server/update'
