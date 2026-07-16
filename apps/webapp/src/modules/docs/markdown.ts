/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published `docs` document at its **hierarchical**
 * canonical URL + `.md` (`/docs/getting-started/cli.md`). `docs` is a
 * `tree: true` collection, so this mirrors the HTML splat route: leaf-resolve
 * the splat, derive the ancestor chain, then
 *   - 301 a non-canonical-but-reachable form to the canonical `.md` URL,
 *   - 404 when the leaf is missing or an unpublished ancestor hides the subtree,
 *   - otherwise serialize with the hierarchical canonical baked in.
 *
 * Always published-only (preview never applies to the agent surface), reading
 * through the *public* client. The shared serialization / caching machinery
 * lives in `@/lib/markdown`; the tree resolution is shared with the HTML route
 * via `./resolve.server`.
 */

import { getPublicBylineClient } from '@byline/client/server'

import { isRoutableLocale } from '@/i18n/i18n-config'
import { getDocumentMarkdown, markdownResponse } from '@/lib/markdown'
import { buildLocalizedPath } from '@/lib/meta'
import { resolveDocTreeBySplat } from './resolve.server'

/** Normalize a splat to comparable, decoded, empty-free segments. */
function segmentsOf(splat: string): string[] {
  return splat
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter((s) => s.length > 0)
}

/**
 * Resolve `/docs/<chain>.md` to a final `Response` — markdown (200), a 301 to
 * the canonical `.md` URL, or a 404. Mirrors the HTML splat route's
 * canonicalization so the two surfaces stay in lockstep.
 */
export async function docMarkdownResponse(lng: string, splat: string): Promise<Response> {
  if (!isRoutableLocale(lng)) return markdownResponse(null)

  const handle = getPublicBylineClient().collection('docs')
  const resolution = await resolveDocTreeBySplat(handle, {
    splat,
    locale: lng,
    status: 'published',
    enforceSpine: true,
    populate: { featureImage: '*' },
  })
  if (resolution == null) return markdownResponse(null)

  const requested = segmentsOf(splat).join('/')
  const canonical = resolution.chainSegments.join('/')
  if (requested !== canonical) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${buildLocalizedPath(lng, 'docs', ...resolution.chainSegments)}.md` },
    })
  }

  const markdown = await getDocumentMarkdown({
    collection: 'docs',
    lng,
    path: resolution.doc.path,
    populate: { featureImage: '*' },
    canonicalSegments: ['docs', ...resolution.chainSegments],
  })
  return markdownResponse(markdown)
}
