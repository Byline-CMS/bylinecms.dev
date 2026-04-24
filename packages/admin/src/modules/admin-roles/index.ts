/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-roles` — role CRUD and role ↔ user assignment.
 *
 * Ability grants against roles live on the sibling
 * `@byline/admin/admin-permissions` module, not here.
 */

export type {
  AdminRoleRow,
  AdminRolesRepository,
  CreateAdminRoleInput,
  UpdateAdminRoleInput,
} from './repository.js'
