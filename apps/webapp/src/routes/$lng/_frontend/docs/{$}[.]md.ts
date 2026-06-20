/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published doc at its hierarchical canonical URL +
 * `.md` — `/docs/getting-started/cli.md`, `/fr/docs/getting-started/cli.md`. A
 * pure server-handler route (no component). `docs` is a `tree: true`
 * collection, so this is a **suffixed splat** (`{$}.md`): `_splat` is the full
 * path after `/docs/`, with `.md` carried as the route suffix — the HTML splat
 * (`$.tsx`) and this one coexist with correct ranking (the suffixed route wins
 * for `.md` requests).
 *
 * Locale flows like the HTML page: the input rewrite treats `.md` as content
 * (not asset) and prefixes the default locale, so the matcher always sees
 * `/$lng/docs/{$}.md` — one markdown variant per content locale. In dev,
 * `devMarkdownPassthrough` (vite.config.ts) keeps Vite's middleware from
 * claiming `.md` requests before SSR sees them.
 *
 * The handler body lives in `src/modules/docs/markdown.ts`, reached via a
 * handler-local dynamic `import()` so the server-only chain (Byline SDK,
 * L1 cache → `node:dns`) stays out of the client graph.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$lng/_frontend/docs/{$}.md')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { lng: string; _splat?: string } }) => {
        const { docMarkdownResponse } = await import('@/modules/docs/markdown')
        return docMarkdownResponse(params.lng, params._splat ?? '')
      },
    },
  },
})
