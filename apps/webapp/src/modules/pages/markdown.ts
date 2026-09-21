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
 * A wrong area redirects to the document's own path, just like HTML.
 * Published-only: preview never applies to this agent-facing surface.
 */

import { getPublicBylineClient } from '@byline/client/server'
import type { PagesFields } from '@byline/generated-types'

import { buildPagePath, type PageArea } from '~/collections/pages/path'

import { isRoutableLocale } from '@/i18n/i18n-config'
import { getDocumentMarkdown, markdownResponse } from '@/lib/markdown'
import { pageAreaRedirect } from './path'

export async function pageMarkdownResponse(
  lng: string,
  path: string,
  requestedArea: PageArea,
  search = ''
): Promise<Response> {
  if (!isRoutableLocale(lng)) return markdownResponse(null)
  const doc = await getPublicBylineClient()
    .collection('pages')
    .findByPath<Pick<PagesFields, 'area'>>(path, {
      select: ['area'],
      locale: lng,
      status: 'published',
    })
  if (doc == null) return markdownResponse(null)

  const destination = pageAreaRedirect(doc, requestedArea, lng)
  if (destination != null) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${destination}.md${search}`, 'Cache-Control': 'no-store' },
    })
  }

  return markdownResponse(
    await getDocumentMarkdown({
      collection: 'pages',
      lng,
      path,
      populate: { featureImage: '*', photo: '*', video: '*', videoMobile: '*' },
      canonicalSegments: (fields) => {
        const pagePath = buildPagePath({ path, fields })
        return pagePath == null ? [] : [pagePath]
      },
    })
  )
}
