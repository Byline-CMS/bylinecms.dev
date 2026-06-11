/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared machinery for the `.md` routes — the markdown representation of
 * published documents at their canonical URL + `.md`. Per-collection
 * modules (`src/modules/<collection>/markdown.ts`) supply the populate
 * config and URL segments; this module owns loading, serialization,
 * caching, and response shaping.
 *
 * Reads through the *public* client (`status: 'published'` — drafts never
 * leak; preview never applies to the agent surface, same contract as the
 * sitemap). Serialized markdown is cached in L1 tagged with the document's
 * detail tag, so the collection hooks' per-document invalidation sweeps it
 * on every edit alongside the HTML reads.
 */

import { documentToMarkdown, getCollectionDefinition, getServerConfig } from '@byline/core'
import { getPublicBylineClient } from '@byline/host-tanstack-start/integrations/byline-public-client'

import { getPublicConfig } from '@/config'
import { isRoutableLocale } from '@/i18n/i18n-config'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { buildLocalizedPath } from '@/lib/meta'

/** Markdown variants ride the same per-document invalidation as HTML reads. */
const MD_TTL_MS = 60 * 60 * 1000

/**
 * Map a relation target to its public HTML URL. Returns `undefined` for
 * collections without a public detail page (e.g. `media`), which renders
 * the relation as plain text instead of a broken link. Pages compose from
 * the document's `area` at render time — from a bare relation we can only
 * assume root.
 */
function publicUrlFor(collectionPath: string, documentPath: string): string[] | undefined {
  switch (collectionPath) {
    case 'docs':
    case 'news':
      return [collectionPath, documentPath]
    case 'pages':
      return [documentPath]
    default:
      return undefined
  }
}

export interface GetDocumentMarkdownOptions {
  collection: string
  lng: string
  path: string
  /** Relation populate map for the read (mirrors the HTML detail loader). */
  populate?: Record<string, '*'>
  /**
   * URL segments (after the locale) of the document's canonical HTML page —
   * e.g. `['docs', path]` — or a function deriving them from the loaded
   * fields (pages compose their canonical from the document's `area`).
   * The canonical is always the *true* canonical, independent of which URL
   * shape the request used: the `.md` surface mirrors the HTML routes,
   * which serve a page at any prefix and treat `area` purely as link
   * composition.
   */
  canonicalSegments: string[] | ((fields: Record<string, any>) => string[])
}

export async function getDocumentMarkdown(
  options: GetDocumentMarkdownOptions
): Promise<string | null> {
  const { collection, lng, path } = options
  if (!isRoutableLocale(lng)) return null
  const definition = getCollectionDefinition(collection)
  if (!definition) return null

  return withCache<string | null>({
    // One entry per (collection, path, locale): every URL shape for one
    // document serves identical output (the canonical is derived from the
    // document itself), so the shapes deliberately share the entry.
    cacheKey: `${cacheKeys.detail(collection, path, lng)}::md`,
    tags: [tags.detail(collection, path), tags.collection(collection)],
    ttl: MD_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const doc = await client.collection(collection).findByPath(path, {
        populate: options.populate,
        locale: lng,
        status: 'published',
      })
      if (doc == null) return null

      const segments =
        typeof options.canonicalSegments === 'function'
          ? options.canonicalSegments(doc.fields as Record<string, any>)
          : options.canonicalSegments
      const { serverUrl } = getPublicConfig()
      const toMarkdown = getServerConfig().fields?.richText?.toMarkdown
      const absolute = (relative: string) => new URL(relative, serverUrl).toString()

      return documentToMarkdown(doc, definition, {
        locale: lng,
        canonicalUrl: absolute(buildLocalizedPath(lng, ...segments)),
        richTextToMarkdown: toMarkdown,
        resolveUrl: (collectionPath, documentPath) => {
          const segments = publicUrlFor(collectionPath, documentPath)
          return segments ? absolute(buildLocalizedPath(lng, ...segments)) : undefined
        },
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
