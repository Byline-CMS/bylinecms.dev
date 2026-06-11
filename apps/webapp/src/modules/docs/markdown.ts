/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown representation of a published `docs` document — the handler
 * body behind `/​{lng}/docs/{path}.md` (see the route at
 * `src/routes/$lng/_frontend/docs/{$path}[.]md.ts`). Server-only: the
 * route reaches this module through a handler-local dynamic `import()`,
 * the same pattern as `sitemap[.]xml.ts`.
 *
 * Reads through the *public* client (`status: 'published'` — drafts never
 * leak; preview never applies to the agent surface, same contract as the
 * sitemap). The serialized markdown is cached in L1 tagged with the
 * document's detail tag, so the collection hooks' per-document
 * invalidation sweeps it on every edit alongside the HTML reads.
 */

import { documentToMarkdown, getCollectionDefinition, getServerConfig } from '@byline/core'
import { getPublicBylineClient } from '@byline/host-tanstack-start/integrations/byline-public-client'

import { getPublicConfig } from '@/config'
import { i18nConfig, isRoutableLocale } from '@/i18n/i18n-config'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { buildLocalizedPath } from '@/lib/meta'
import type { DocDetailFields } from './detail'

/** Markdown variants ride the same per-document invalidation as HTML reads. */
const MD_TTL_MS = 60 * 60 * 1000

export async function getDocMarkdown(lng: string, path: string): Promise<string | null> {
  if (!isRoutableLocale(lng)) return null
  const definition = getCollectionDefinition('docs')
  if (!definition) return null

  return withCache<string | null>({
    cacheKey: `${cacheKeys.detail('docs', path, lng)}::md`,
    tags: [tags.detail('docs', path), tags.collection('docs')],
    ttl: MD_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const doc = await client.collection('docs').findByPath<DocDetailFields>(path, {
        populate: { featureImage: '*' },
        locale: lng,
        status: 'published',
      })
      if (doc == null) return null

      const { serverUrl } = getPublicConfig()
      const toMarkdown = getServerConfig().fields?.richText?.toMarkdown
      const absolute = (relative: string) => new URL(relative, serverUrl).toString()

      return documentToMarkdown(doc, definition, {
        locale: lng,
        canonicalUrl: absolute(buildLocalizedPath(lng, 'docs', path)),
        richTextToMarkdown: toMarkdown,
        resolveUrl: (collectionPath, documentPath) =>
          absolute(buildLocalizedPath(lng, collectionPath, documentPath)),
        resolveFileUrl: (value) =>
          typeof value.storageUrl === 'string'
            ? absolute(value.storageUrl)
            : typeof value.storagePath === 'string'
              ? absolute(`/uploads/${value.storagePath}`)
              : undefined,
      })
    },
  })
}

/** Shared response shaping for `.md` route handlers. */
export function markdownResponse(markdown: string | null): Response {
  if (markdown == null) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // Same HTTP-layer caching posture as the HTML pages: short edge TTL,
      // long background revalidation. Keyed per content locale by the URL.
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400',
    },
  })
}

/** The default content locale — used by route handlers for guard rails. */
export const defaultContentLocale = i18nConfig.defaultLocale
