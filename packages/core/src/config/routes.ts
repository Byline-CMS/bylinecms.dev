/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RoutesConfig } from '@/@types/site-config.js'

/** Default route segments. Installations override either key on the
 * config object; callers read the merged shape via `resolveRoutes()`. */
const DEFAULT_ROUTES: RoutesConfig = {
  admin: '/admin',
  api: '/api',
}

/**
 * Merge a user-supplied (potentially partial) routes config with the
 * built-in defaults. Empty / unset keys fall back to `'/admin'` and
 * `'/api'`. Returns a fully-populated `RoutesConfig` so consumers don't
 * need null checks at every call site.
 */
export function resolveRoutes(routes?: Partial<RoutesConfig>): RoutesConfig {
  return {
    admin: routes?.admin ?? DEFAULT_ROUTES.admin,
    api: routes?.api ?? DEFAULT_ROUTES.api,
  }
}
