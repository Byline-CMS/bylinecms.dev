/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published `news` document — handler body
 * for `/​{lng}/news/{path}.md`. The shared machinery lives in
 * `@/lib/markdown`.
 */

import { getDocumentMarkdown } from '@/lib/markdown'

export { markdownResponse } from '@/lib/markdown'

export async function getNewsMarkdown(lng: string, path: string): Promise<string | null> {
  return getDocumentMarkdown({
    collection: 'news',
    lng,
    path,
    populate: { category: '*', featureImage: '*' },
    canonicalSegments: ['news', path],
  })
}
