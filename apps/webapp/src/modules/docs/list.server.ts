/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the Docs list read. Loaded via a dynamic
 * `import()` from `./list` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `../pages/detail`.
 *
 * Returns published docs ordered by the collection's fractional-index
 * `orderKey` ascending (matches `orderable: true` semantics on the `Docs`
 * schema). Narrow projection — only `title` / `summary` are selected
 * (id/path/status/timestamps are always present on ClientDocument).
 */

import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { DocListFields, DocListInput, DocListResult } from './list'

export async function getDocsList({ lng }: DocListInput): Promise<DocListResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return client.collection('docs').find<DocListFields>({
    select: ['title', 'summary'],
    locale: lng,
    status: preview ? 'any' : 'published',
    sort: { orderKey: 'asc' },
    pageSize: 10_000,
  })
}
