/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published `pages` document — handler body
 * for `/​{lng}/{path}.md`, `/​{lng}/about/{path}.md`, `/​{lng}/legal/{path}.md`.
 * The `area` acceptance check mirrors the HTML routes: a page mounts only
 * under its own area prefix, so `/legal/x.md` can never serve an `about`
 * page. The shared machinery lives in `@/lib/markdown`.
 */

import { getDocumentMarkdown } from '@/lib/markdown'

export { markdownResponse } from '@/lib/markdown'

export type PageArea = 'root' | 'about' | 'legal'

export async function getPageMarkdown(
  lng: string,
  path: string,
  area: PageArea
): Promise<string | null> {
  return getDocumentMarkdown({
    collection: 'pages',
    lng,
    path,
    populate: { featureImage: '*', photo: '*' },
    canonicalSegments: area === 'root' ? [path] : [area, path],
    accept: (fields) => (fields.area ?? 'root') === area,
  })
}
