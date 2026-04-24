/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-permissions` — ability grants against roles.
 *
 * Backs the `byline_admin_permissions` table. The ability keys themselves
 * are registered at `initBylineCore()` time through the `AbilityRegistry`
 * from `@byline/auth`; this module only grants or revokes them per role.
 */

export type { AdminPermissionsRepository } from './repository.js'
