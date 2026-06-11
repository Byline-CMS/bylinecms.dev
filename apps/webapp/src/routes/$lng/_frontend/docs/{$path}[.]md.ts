/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published doc at its canonical URL + `.md`
 * — `/docs/foo.md`, `/fr/docs/foo.md`. A pure server-handler route (no
 * component); the `{$path}[.]md` segment is a suffixed path param, so the
 * HTML route (`$path.tsx`) and this one coexist with correct ranking.
 *
 * Locale flows like the HTML page: the input rewrite treats `.md` as
 * content (not asset) and prefixes the default locale, so the matcher
 * always sees `/$lng/docs/{$path}.md` — one markdown variant per content
 * locale. In dev, `devMarkdownPassthrough` (vite.config.ts) keeps Vite's
 * middleware from claiming `.md` requests before SSR sees them.
 *
 * The handler body lives in `src/modules/docs/markdown.ts`, reached via a
 * handler-local dynamic `import()` so the server-only chain (Byline SDK,
 * L1 cache → `node:dns`) stays out of the client graph — the same pattern
 * as `sitemap[.]xml.ts`.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$lng/_frontend/docs/{$path}.md')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { lng: string; path: string } }) => {
        const { getDocMarkdown, markdownResponse } = await import('@/modules/docs/markdown')
        return markdownResponse(await getDocMarkdown(params.lng, params.path))
      },
    },
  },
})
