/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/db-postgres/admin` — Postgres implementations of the admin
 * repository contracts declared in `@byline/admin`.
 *
 * Most callers want `createAdminStore(db)` — it bundles all four
 * repositories into the `AdminStore` shape that `@byline/admin` consumers
 * (the built-in `JwtSessionProvider`, `seedSuperAdmin`, admin-user and
 * admin-role commands) expect. Individual factories remain exported for
 * unusual cases (custom wiring, partial testing).
 *
 * No session-provider code lives here — `JwtSessionProvider` moved to
 * `@byline/admin/auth`. This package only supplies the adapter-shaped
 * pieces it implements.
 */

export { createAdminPermissionsRepository } from './admin-permissions-repository.js'
export { createAdminRolesRepository } from './admin-roles-repository.js'
export { createAdminStore } from './admin-store.js'
export { createAdminUsersRepository } from './admin-users-repository.js'
export { createRefreshTokensRepository } from './refresh-tokens-repository.js'
