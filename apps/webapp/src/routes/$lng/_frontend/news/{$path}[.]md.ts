/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published news item at `/news/{path}.md`.
 * A pure server-handler route — see `src/routes/$lng/_frontend/docs/{$path}[.]md.ts`
 * for the full pattern notes (suffixed path param, locale rewrite, dev
 * passthrough, handler-local dynamic import).
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$lng/_frontend/news/{$path}.md')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { lng: string; path: string } }) => {
        const { getNewsMarkdown, markdownResponse } = await import('@/modules/news/markdown')
        return markdownResponse(await getNewsMarkdown(params.lng, params.path))
      },
    },
  },
})
