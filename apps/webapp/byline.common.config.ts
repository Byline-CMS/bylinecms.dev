/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared, framework-agnostic configuration consumed by both
 * `byline.server.config.ts` (server / SSR) and `byline.admin.config.ts`
 * (browser / admin UI).
 *
 * Anything that's serializable and needed in both contexts lives here so
 * there's a single source of truth — `serverURL`, `routes`, and `i18n`.
 * Anything that pulls in server-only modules (db adapter, session
 * provider, storage provider) stays in the server config; anything that
 * pulls in admin UI components (formatters, column definitions) stays in
 * the admin config.
 */

import type { RoutesConfig } from '@byline/core'

export { i18n } from './byline/i18n.js'

export const serverURL = 'http://localhost:5173/'

/**
 * URL segments for admin and (future) public API routes. Defaults of
 * `/admin` and `/api` are applied automatically by `resolveRoutes()` —
 * keys only need to be set here when overriding either default.
 */
export const routes: Partial<RoutesConfig> = {
  admin: '/admin',
  api: '/api',
}
