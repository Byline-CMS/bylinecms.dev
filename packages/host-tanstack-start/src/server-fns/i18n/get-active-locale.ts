/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Resolve the active interface locale for the current request as a
 * server function. Wraps `resolveRequestLocale` so route `beforeLoad`
 * callers in client-touching files don't transitively pull the
 * `@tanstack/react-start/server` import (and the
 * `@tanstack/start-server-core` graph behind it) into the client
 * bundle. Same pattern as `getCurrentAdminUser`.
 */

import { createServerFn } from '@tanstack/react-start'

import { resolveRequestLocale } from '../../i18n/resolve-locale.js'

export const getActiveLocaleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    return resolveRequestLocale()
  }
)
