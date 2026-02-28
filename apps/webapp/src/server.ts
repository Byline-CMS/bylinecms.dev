/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Initialize Byline server config (DB adapter, etc.) before handling any requests.
import '../byline.server.config.ts'

// NOTE: The client config (collection admin UI configs) is initialized in
// src/config/init-client-config.ts, imported from __root.tsx. That module runs
// in the SSR render context — the same Vite environment where route components
// execute. Importing byline.client.config.ts HERE would only set it in the
// server entry environment, which is isolated from the SSR render environment
// in TanStack Start / Vite 6.

import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
