/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Route factories for the Byline admin UI on TanStack Start.
 *
 * Each factory takes a path string (the host's filesystem-backed route
 * path) and returns the `Route` object produced by
 * `createFileRoute(path)({...})`. The host's route file collapses to:
 *
 *   import { createCollectionListRoute } from '@byline/host-tanstack-start/routes'
 *   export const Route = createCollectionListRoute('/(byline)/admin/collections/$collection/')
 *
 * Routes that need host-specific data (i18n bridge component, content
 * locales) take a second `opts` argument.
 */

export { createAdminAccountRoute } from './create-admin-account-route.js'
export { createAdminDashboardRoute } from './create-admin-dashboard-route.js'
export { createAdminLayoutRoute } from './create-admin-layout-route.js'
export { createAdminPermissionsRoute } from './create-admin-permissions-route.js'
export { createAdminRoleEditRoute } from './create-admin-role-edit-route.js'
export { createAdminRolesListRoute } from './create-admin-roles-list-route.js'
export { createAdminUserEditRoute } from './create-admin-user-edit-route.js'
export { createAdminUsersListRoute } from './create-admin-users-list-route.js'
export { createCollectionApiRoute } from './create-collection-api-route.js'
export { createCollectionCreateRoute } from './create-collection-create-route.js'
export { createCollectionEditRoute } from './create-collection-edit-route.js'
export { createCollectionHistoryRoute } from './create-collection-history-route.js'
export { createCollectionListRoute } from './create-collection-list-route.js'
export { createSignInRoute } from './create-sign-in-route.js'
