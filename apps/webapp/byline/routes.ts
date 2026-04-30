/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * URL segments for admin and (future) public API routes. Defaults of
 * `/admin` and `/api` are applied automatically by `resolveRoutes()` —
 * keys only need to be set here when overriding either default.
 */

import type { RoutesConfig } from '@byline/core'

export const routes: Partial<RoutesConfig> = {
  admin: '/admin',
  api: '/api',
}

/**
 * Fallback used by both server and admin entry points when no
 * `VITE_SERVER_URL` env var is set. Each entry resolves the env var
 * itself (Vite's `import.meta.env` on the client, Node's `process.env`
 * on the server) and falls back to this literal.
 */
export const DEFAULT_SERVER_URL = 'http://localhost:5173/'
