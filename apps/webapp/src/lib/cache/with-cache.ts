/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `withCache` — the read-path wrapper, the Byline analogue of infonomic.io's
 * `executeWithOptions`. Wrap a storage read in it inside a public server fn:
 *
 *   return withCache({
 *     cacheKey: cacheKeys.list('docs', lng),
 *     tags: [tags.collection('docs'), tags.list('docs')],
 *     preview,                       // editors bypass L1 entirely
 *     fn: () => client.collection('docs').find({ ... }),
 *   })
 *
 * Collection hooks invalidate with the write-side helpers (`invalidateDocument`
 * / `invalidateCollection`) which use the same `tags` vocabulary, so the read
 * and write sides cannot drift.
 *
 * Three things switch the cache OFF and call `fn` directly:
 *   1. `cache.dataRequests` is not enabled (the master switch / default).
 *   2. `preview === true` — a signed-in editor with preview active must
 *      always see live, unpublished content (`isPreviewActive()` already
 *      resolves the cookie + admin session in the server fns).
 *   3. (implicitly) any caller that simply doesn't reach for `withCache`.
 *
 * Cache keys MUST encode everything that determines the response —
 * collection, shape (list/details/sitemap), path, locale, and read mode —
 * so a draft can never be served to anonymous traffic and one locale's
 * content can never leak into another. The `cacheKeys` / `tags` helpers
 * below are the single source of truth for those strings; the collection
 * hooks invalidate using the same `tags` helper, so the two sides cannot
 * drift. See docs/DATA-CACHE-DESIGN.md.
 */

import { getServerConfig } from '@/config'
import { getCache, invalidateTag } from './index'

/**
 * Read mode baked into every key. Editors bypass L1, so everything the cache
 * stores is `published`; the literal is included defensively so a future
 * caller that ever caches `any` can never collide with a published entry.
 */
const PUBLISHED = 'published'

/**
 * Tag vocabulary — the single source of truth shared by the read paths (which
 * tag entries) and the collection hooks (which invalidate them).
 *
 * Now that every Byline lifecycle hook carries the document `path` (@byline/core
 * 3.1+), invalidation is per-document, not collection-wide. Each cached read
 * carries TWO tags:
 *
 *   - a granular tag for its own shape (`details(path)` / `list` / `sitemap`), and
 *   - the coarse `collection` tag, as a deliberate "big hammer" reserved for
 *     cross-collection embeds (e.g. a news-category edit must clear every news
 *     read because category data is populated into them) — NOT used by a
 *     collection's own per-document edits.
 *
 * So a normal edit to one document clears only that document's details (and the
 * list/sitemap as needed), leaving every *other* document's cached details warm.
 *
 * `details` is locale-agnostic on purpose: one document renders under several
 * locale keys, and an edit should clear all of them. (Safe while Byline has no
 * localized paths; revisit when per-locale paths land — see DATA-CACHE-DESIGN.md.)
 */
export const tags = {
  /** Coarse: every cached read of the collection. Big hammer for embeds/bulk. */
  collection: (collectionPath: string): string => `cms::${collectionPath}`,
  /** One document's details page, across all locales. */
  details: (collectionPath: string, path: string): string =>
    `cms::${collectionPath}::details::${path}`,
  /** The collection's list reads (any filter/pagination). */
  list: (collectionPath: string): string => `cms::${collectionPath}::list`,
  /** The collection's sitemap read. */
  sitemap: (collectionPath: string): string => `cms::${collectionPath}::sitemap`,
}

/** A query parameter that participates in a list cache key (filter, page, etc.). */
export type ListParams = Record<string, string | number | boolean | undefined>

/**
 * Serialise list params deterministically: drop `undefined`, sort by key, so
 * `{ page: 1, category: 'x' }` and `{ category: 'x', page: 1 }` collide.
 */
function serializeParams(params?: ListParams): string {
  if (params == null) return ''
  return Object.entries(params)
    .filter(([, value]) => value != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `::${key}::${value}`)
    .join('')
}

/** Cache-key conventions, one per read shape. */
export const cacheKeys = {
  /**
   * `params` carries the filter / pagination inputs that change the result
   * (e.g. `{ category, page, pageSize }`). Omit for a plain unfiltered list.
   */
  list: (collectionPath: string, locale: string | undefined, params?: ListParams): string =>
    `cms::${collectionPath}::list::${locale ?? 'default'}${serializeParams(params)}::${PUBLISHED}`,
  details: (collectionPath: string, path: string, locale: string | undefined): string =>
    `cms::${collectionPath}::details::${path}::${locale ?? 'default'}::${PUBLISHED}`,
  sitemap: (collectionPath: string): string => `cms::${collectionPath}::sitemap::${PUBLISHED}`,
}

export interface WithCacheOptions<T> {
  cacheKey: string
  tags?: string[]
  /** Per-entry TTL (ms). Falls back to `cache.ttl` from config when omitted. */
  ttl?: number
  /**
   * In-memory SWR trigger (ms of remaining TTL): once an entry's remaining
   * TTL drops below this, the stale value is served while `fn` refreshes it
   * in the background. Falls back to `cache.refreshThreshold` from config.
   */
  refreshThreshold?: number
  /** Editor preview active for this request → bypass L1 and read live. */
  preview?: boolean
  fn: () => Promise<T>
}

export async function withCache<T>({
  cacheKey,
  tags: entryTags,
  ttl,
  refreshThreshold,
  preview = false,
  fn,
}: WithCacheOptions<T>): Promise<T> {
  const { cache } = getServerConfig()
  if (preview || !cache.dataRequests) {
    return fn()
  }
  // Config supplies the defaults; explicit per-call args win.
  return getCache().wrap(cacheKey, fn, {
    ttl: ttl ?? cache.ttl,
    refreshThreshold: refreshThreshold ?? cache.refreshThreshold,
    tags: entryTags,
  })
}

// ---------------------------------------------------------------------------
// Write-side helpers — call these from collection lifecycle hooks.
// ---------------------------------------------------------------------------

export interface InvalidateDocumentOptions {
  /**
   * The document's previous path, when an edit may have re-anchored it (from
   * `originalData.path` in `afterUpdate`). Clears the stale details entry under
   * the old path in addition to the new one. No-op when equal/absent.
   */
  prevPath?: string
  /** Also invalidate the collection's list reads. Set for list-bearing collections. */
  list?: boolean
  /**
   * Also invalidate the sitemap. Set for *structural* changes (create / delete /
   * publish / unpublish) that change the URL set. A plain content edit leaves
   * the sitemap to its long TTL — `lastmod` drift is low-stakes.
   */
  sitemap?: boolean
}

/**
 * Invalidate the L1 cache for a single document after a lifecycle event.
 * Always clears that document's details (all locales); `list` / `sitemap` are
 * opt-in per the event and collection shape. This is the per-document successor
 * to the old collection-wide sweep — other documents' cached details survive.
 */
export async function invalidateDocument(
  collectionPath: string,
  path: string,
  options: InvalidateDocumentOptions = {}
): Promise<void> {
  await invalidateTag(tags.details(collectionPath, path))
  if (options.prevPath != null && options.prevPath !== path) {
    await invalidateTag(tags.details(collectionPath, options.prevPath))
  }
  if (options.list === true) await invalidateTag(tags.list(collectionPath))
  if (options.sitemap === true) await invalidateTag(tags.sitemap(collectionPath))
}

/**
 * The coarse "big hammer": clear every cached read of a collection. Reserve for
 * cross-collection embed invalidation (e.g. a news-category edit clearing all
 * news reads), not a collection's own per-document edits.
 */
export async function invalidateCollection(collectionPath: string): Promise<void> {
  await invalidateTag(tags.collection(collectionPath))
}
