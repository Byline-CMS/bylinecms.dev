/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Initialize Byline server config (DB adapter, etc.) before handling any requests.
import '../byline/server.config.ts'

// NOTE: The admin config (collection admin UI configs) is registered by the
// `_byline` route (`src/routes/_byline/route.tsx` `beforeLoad` +
// `route.lazy.tsx` side-effect import), which run in the SSR render context —
// the same Vite environment where route components execute. Importing the
// admin config HERE would only register it in the server entry environment,
// which is isolated from the SSR render environment in TanStack Start / Vite 8.

import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

import { serveUploads } from '@byline/host-tanstack-start/integrations/serve-uploads'

// Runtime mount for `/uploads/*`. The local storage provider writes to
// `<cwd>/uploads`; `serveUploads` streams that directory back on every
// request so new uploads appear without a rebuild. See the helper module
// for why `nitro.publicAssets` cannot be used here. Must match `uploadDir`
// in `byline/server.config.ts`.
export default createServerEntry({
  async fetch(request) {
    const upload = await serveUploads(request)
    if (upload) return upload
    return handler.fetch(request)
  },
})
