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

import { negotiateLocaleRedirect } from '@/i18n/server-locale-redirect'
import { negotiateMarkdownRedirect } from '@/lib/markdown-negotiation'

// The server entry is the lowest app-owned request chokepoint — it runs on
// the original, un-rewritten request before the router (and therefore before
// `rewrite.input`). Two jobs here, in order:
//
//   1. `/uploads/*` — the local storage provider writes to `<cwd>/uploads`;
//      `serveUploads` streams that directory back on every request so new
//      uploads appear without a rebuild. See the helper for why
//      `nitro.publicAssets` cannot be used. Must match `uploadDir` in
//      `byline/server.config.ts`.
//   2. Locale negotiation / canonicalisation — redirect a first-time visitor
//      to their preferred non-default interface locale, and 301 an
//      externally-typed `/en/…` to the clean form. This MUST run here rather
//      than in route middleware: `rewrite.input` prepends the default locale
//      before route middleware sees the URL, hiding whether it arrived bare.
//      See `src/i18n/server-locale-redirect.ts`.
export default createServerEntry({
  async fetch(request) {
    const upload = await serveUploads(request)
    if (upload) return upload

    const localeRedirect = negotiateLocaleRedirect(request)
    if (localeRedirect) return localeRedirect

    // 3. `Accept: text/markdown` on a canonical HTML URL → 302 to the `.md`
    //    sibling. Strict (never fires for browsers) and redirect-based so
    //    cache keys stay distinct. See `src/lib/markdown-negotiation.ts`.
    const markdownRedirect = negotiateMarkdownRedirect(request)
    if (markdownRedirect) return markdownRedirect

    return handler.fetch(request)
  },
})
