/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published `pages` document — handler body
 * for `/{lng}/{path}.md`, `/{lng}/about/{path}.md`, `/{lng}/legal/{path}.md`.
 *
 * Mirrors the HTML routes' semantics exactly: a page serves at any prefix
 * (the HTML loaders never enforce `area` — it drives link composition
 * only), and the frontmatter `canonical` composes from the document's own
 * `area`, independent of which URL shape the request used. The shared
 * machinery lives in `@/lib/markdown`.
 */

import { getDocumentMarkdown } from '@/lib/markdown'

export { markdownResponse } from '@/lib/markdown'

const AREA_PREFIX: Record<string, string[]> = {
  about: ['about'],
  legal: ['legal'],
  // `root` (and anything unrecognised) → no prefix.
}

export async function getPageMarkdown(lng: string, path: string): Promise<string | null> {
  return getDocumentMarkdown({
    collection: 'pages',
    lng,
    path,
    populate: { featureImage: '*', photo: '*' },
    canonicalSegments: (fields) => [...(AREA_PREFIX[fields.area ?? 'root'] ?? []), path],
  })
}
