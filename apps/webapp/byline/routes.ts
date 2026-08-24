/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-safe URL paths shared by the admin and server configurations. Resolve
 * them once at this dependency-free boundary so every consumer sees the same
 * normalized, frozen paths.
 *
 * These values configure Byline-owned namespaces; they do not create routes.
 * The host's physical TanStack route tree must use the same paths. In
 * particular, `api` reserves an internal namespace but does not promise a
 * stable public document HTTP API.
 */

import { resolveRoutes } from '@byline/core'

export const routes = resolveRoutes({
  // Mount for the complete CMS administration tree.
  admin: '/admin',
  // Reserved internal endpoint prefix. The reference app places its separate,
  // application-owned analytics ingress at `/telemetry/events`; document and
  // upload operations still use host server functions rather than a general
  // public API.
  api: '/api',
  // Public authentication entry point used by guards and redirect builders.
  signIn: '/sign-in',
})
