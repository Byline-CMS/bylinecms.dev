/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published about-area page at `/about/{path}.md`.
 * A pure server-handler route — see `src/routes/$lng/_frontend/docs/{$path}[.]md.ts`
 * for the full pattern notes (suffixed path param, locale rewrite, dev
 * passthrough, handler-local dynamic import).
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$lng/_frontend/about/{$path}.md')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { lng: string; path: string } }) => {
        const { getPageMarkdown, markdownResponse } = await import('@/modules/pages/markdown')
        return markdownResponse(await getPageMarkdown(params.lng, params.path))
      },
    },
  },
})
