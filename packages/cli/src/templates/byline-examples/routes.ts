/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-safe URL paths for admin, sign-in, and the future public API.
 * Resolve once at this client-safe configuration boundary so consumers only
 * read canonical paths.
 */

import { resolveRoutes } from '@byline/core'

export const routes = resolveRoutes({
  admin: '/admin',
  api: '/api',
  signIn: '/sign-in',
})

/**
 * Fallback used by both server and admin entry points when no
 * `VITE_SERVER_URL` env var is set. Each entry resolves the env var
 * itself (Vite's `import.meta.env` on the client, Node's `process.env`
 * on the server) and falls back to this literal.
 */
export const DEFAULT_SERVER_URL = 'http://localhost:5173/'
