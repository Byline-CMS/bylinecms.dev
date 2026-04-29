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
 * there's a single source of truth — `routes`, `i18n`, and the
 * `DEFAULT_SERVER_URL` literal. Env-var access does not belong here:
 * Vite's `import.meta.env` and Node's `process.env` are different
 * mechanisms, so each entry point resolves `serverURL` itself using the
 * API native to its runtime (see `byline.server.config.ts` and
 * `byline.admin.config.ts`).
 */

import type { RoutesConfig } from '@byline/core'

export { i18n } from './byline/i18n.js'

export const DEFAULT_SERVER_URL = 'http://localhost:5173/'

/**
 * URL segments for admin and (future) public API routes. Defaults of
 * `/admin` and `/api` are applied automatically by `resolveRoutes()` —
 * keys only need to be set here when overriding either default.
 */
export const routes: Partial<RoutesConfig> = {
  admin: '/admin',
  api: '/api',
}
