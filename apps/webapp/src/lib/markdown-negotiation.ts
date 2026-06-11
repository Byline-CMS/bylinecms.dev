/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `Accept: text/markdown` content negotiation on canonical HTML URLs — the
 * third advertisement channel for the agent-readable surface (alongside
 * the `.md` URL convention and the `<link rel="alternate">` head tags).
 *
 * Deliberately a **redirect**, not a 200 with `Vary: Accept`: serving two
 * bodies from one URL forces every cache between origin and agent to key
 * on the Accept header, and one mis-configured layer poisons the HTML for
 * browsers. A 302 to the `.md` sibling keeps the cache keys distinct —
 * the markdown lives at its own URL, negotiation just points there.
 *
 * Deliberately **strict**: only requests whose Accept header names
 * `text/markdown` and does NOT name `text/html` redirect. Browsers always
 * lead with `text/html`, so they can never be diverted; agents requesting
 * markdown explicitly get exactly what they asked for. A content path with
 * no markdown representation (a section index like `/docs`) redirects and
 * 404s — a correct "no markdown here" answer for a best-effort channel.
 *
 * Runs in the server entry (`src/server.ts`) beside the locale
 * negotiation, for the same reason: it needs the original, un-rewritten
 * request.
 */

import { isLocalizablePath } from '@/i18n/locale-rewrite'

export function negotiateMarkdownRedirect(request: Request): Response | null {
  if (request.method !== 'GET') return null

  const accept = request.headers.get('accept') ?? ''
  if (!accept.includes('text/markdown') || accept.includes('text/html')) return null

  const url = new URL(request.url)
  const pathname = url.pathname
  if (pathname.endsWith('.md')) return null
  if (pathname === '/' || pathname.endsWith('/')) return null
  if (!isLocalizablePath(pathname)) return null

  url.pathname = `${pathname}.md`
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      // Belt-and-braces: the redirect itself must never be cached against
      // the bare URL, or a CDN could serve it to browsers.
      'Cache-Control': 'no-store',
      Vary: 'Accept',
    },
  })
}
