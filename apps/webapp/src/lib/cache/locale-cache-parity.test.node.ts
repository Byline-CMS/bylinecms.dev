/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Cache parity between an advertised-locale change and unpublish.
 *
 * Checking or unchecking a translation changes what public reads deliver, so
 * the reference app's `afterSystemFieldsChange` hook must clear the same local
 * cache surfaces as `afterUnpublish`: the document's details in every locale
 * (including cached misses), the collection's list and navigation reads, the
 * sitemap, and the Markdown export. These tests prime the real tagged cache
 * through the real `withCache` wrapper with the keys and tags the public server
 * modules use, run the real hooks, and record which entries refill.
 *
 * The guarantee is local-process parity with unpublish only. Cluster fan-out
 * is best-effort, fills already in flight can repopulate an entry, dependent
 * pages that embed this document keep their own entries, and CDN responses are
 * untouched. None of that is claimed here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({
  getServerConfig: () => ({
    cache: { dataRequests: true, ttl: 60_000, refreshThreshold: 0, clusterEnabled: false },
  }),
}))

vi.mock('@byline/core', () => ({
  defineHooks: <T>(hooks: T) => hooks,
}))

// Search reconciliation is covered by the hook tests; here it must simply succeed.
vi.mock('@byline/client/server', () => ({
  getSystemBylineClient: () => ({
    collection: () => ({
      indexDocument: vi.fn().mockResolvedValue(undefined),
      removeFromIndex: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}))

import docsHooks from '~/collections/docs/hooks.js'
import newsHooks from '~/collections/news/hooks.js'
import pagesHooks from '~/collections/pages/hooks.js'

import { clear } from './index.js'
import { cacheKeys, tags, withCache } from './with-cache.js'

type Collection = 'docs' | 'news' | 'pages'

interface Surface {
  name: string
  cacheKey: string
  tags: string[]
  /** What the source read returns: `null` is a cached miss (a negative entry). */
  value: unknown
}

const LOCALES = ['en', 'fr', 'es'] as const

/** The entries the public server modules create, with their real keys and tags. */
function surfacesFor(collection: Collection, path: string): Surface[] {
  const details = LOCALES.map((lng) => ({
    name: `details:${path}:${lng}`,
    cacheKey: cacheKeys.details(collection, path, lng),
    tags: [tags.collection(collection), tags.details(collection, path)],
    // Spanish is withheld here, so its read is cached as a miss.
    value: lng === 'es' ? null : { path, lng },
  }))
  const markdown = LOCALES.map((lng) => ({
    name: `markdown:${path}:${lng}`,
    cacheKey: `${cacheKeys.details(collection, path, lng)}::md:v2`,
    tags: [tags.details(collection, path), tags.collection(collection)],
    value: lng === 'es' ? null : `# ${path} (${lng})`,
  }))
  const sitemap = {
    name: 'sitemap',
    cacheKey: cacheKeys.sitemap(collection),
    tags: [tags.collection(collection), tags.sitemap(collection)],
    value: [{ path }],
  }
  const unrelated = {
    name: 'details:unrelated:en',
    cacheKey: cacheKeys.details(collection, 'unrelated', 'en'),
    tags: [tags.collection(collection), tags.details(collection, 'unrelated')],
    value: { path: 'unrelated' },
  }
  const extra: Surface[] = []
  if (collection === 'docs') {
    for (const lng of LOCALES) {
      extra.push({
        name: `nav:${lng}`,
        cacheKey: cacheKeys.list('docs', lng),
        tags: [tags.collection('docs'), tags.list('docs')],
        value: { nodes: [] },
      })
    }
  }
  if (collection === 'news') {
    for (const lng of LOCALES) {
      extra.push({
        name: `list:${lng}`,
        cacheKey: cacheKeys.list('news', lng, { page: 1, pageSize: 10 }),
        tags: [tags.collection('news'), tags.list('news')],
        value: { docs: [] },
      })
    }
  }
  if (collection === 'pages') {
    extra.push({
      name: `path-lookup:${path}`,
      cacheKey: `${cacheKeys.details('pages', path, 'en')}::path`,
      tags: [tags.collection('pages'), tags.details('pages', path)],
      value: `/${path}`,
    })
  }
  return [...details, ...markdown, sitemap, unrelated, ...extra]
}

/** Prime every surface, run `effect`, then report which surfaces refilled. */
async function evictedBy(
  surfaces: Surface[],
  effect: () => Promise<void>
): Promise<{ evicted: string[]; fresh: Record<string, unknown> }> {
  await clear()
  for (const surface of surfaces) {
    await withCache({
      cacheKey: surface.cacheKey,
      tags: surface.tags,
      fn: async () => surface.value,
    })
  }
  await effect()
  const evicted: string[] = []
  const fresh: Record<string, unknown> = {}
  for (const surface of surfaces) {
    fresh[surface.name] = await withCache({
      cacheKey: surface.cacheKey,
      tags: surface.tags,
      fn: async () => {
        evicted.push(surface.name)
        // A fresh read after the locale change: Spanish is now eligible.
        return surface.value === null ? { refreshed: true } : surface.value
      },
    })
  }
  return { evicted: evicted.sort(), fresh }
}

const hooksFor = { docs: docsHooks, news: newsHooks, pages: pagesHooks } as const

async function run(hook: unknown, context: unknown): Promise<void> {
  for (const fn of Array.isArray(hook) ? hook : [hook]) {
    await (fn as (c: unknown) => Promise<void>)(context)
  }
}

describe('advertised-locale cache parity with unpublish', () => {
  beforeEach(async () => {
    await clear()
  })

  it.each(['docs', 'news', 'pages'] as const)(
    '%s: a locale-only change clears exactly the surfaces unpublish clears',
    async (collection) => {
      const hooks = hooksFor[collection]
      const surfaces = surfacesFor(collection, 'launch')

      const unpublish = await evictedBy(surfaces, () =>
        run(hooks.afterUnpublish, {
          collectionPath: collection,
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
          path: 'launch',
        })
      )
      const locale = await evictedBy(surfaces, () =>
        run(hooks.afterSystemFieldsChange, {
          documentId: 'doc-1',
          collectionPath: collection,
          requested: { path: false, availableLocales: true },
          changed: { path: false, availableLocales: true },
          reconciliation: false,
          previousPath: 'launch',
          currentPath: 'launch',
          previousAvailableLocales: ['en'],
          currentAvailableLocales: ['en', 'es'],
        })
      )

      expect(locale.evicted).toEqual(unpublish.evicted)
      // Every locale variant of the document, including the cached miss.
      for (const lng of LOCALES) {
        expect(locale.evicted).toContain(`details:launch:${lng}`)
        expect(locale.evicted).toContain(`markdown:launch:${lng}`)
      }
      expect(locale.evicted).toContain('sitemap')
      if (collection === 'docs') expect(locale.evicted).toContain('nav:es')
      if (collection === 'news') expect(locale.evicted).toContain('list:es')
      if (collection === 'pages') expect(locale.evicted).toContain('path-lookup:launch')
      // Other documents keep their entries, as with unpublish.
      expect(locale.evicted).not.toContain('details:unrelated:en')
      // The fresh read replaces the cached miss for the newly eligible locale.
      expect(locale.fresh['details:launch:es']).toEqual({ refreshed: true })
    }
  )

  it.each(['docs', 'news', 'pages'] as const)(
    '%s: a no-op locale reconciliation retry clears the same surfaces again',
    async (collection) => {
      const hooks = hooksFor[collection]
      const surfaces = surfacesFor(collection, 'launch')

      const unpublish = await evictedBy(surfaces, () =>
        run(hooks.afterUnpublish, {
          collectionPath: collection,
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
          path: 'launch',
        })
      )
      const retry = await evictedBy(surfaces, () =>
        run(hooks.afterSystemFieldsChange, {
          documentId: 'doc-1',
          collectionPath: collection,
          requested: { path: false, availableLocales: true },
          changed: { path: false, availableLocales: false },
          reconciliation: true,
          previousPath: 'launch',
          currentPath: 'launch',
          previousAvailableLocales: ['en', 'es'],
          currentAvailableLocales: ['en', 'es'],
        })
      )

      expect(retry.evicted).toEqual(unpublish.evicted)
    }
  )

  it('bypasses the shared cache for preview reads in both directions', async () => {
    const key = cacheKeys.details('news', 'launch', 'es')
    const entryTags = [tags.collection('news'), tags.details('news', 'launch')]

    // A public fill is not served to preview…
    await withCache({ cacheKey: key, tags: entryTags, fn: async () => 'public' })
    const previewRead = await withCache({
      cacheKey: key,
      tags: entryTags,
      preview: true,
      fn: async () => 'editorial',
    })
    expect(previewRead).toBe('editorial')

    // …and a preview read never populates the entry public readers get, so
    // turning preview off or signing out cannot reuse an editorial object.
    await clear()
    await withCache({ cacheKey: key, tags: entryTags, preview: true, fn: async () => 'editorial' })
    const publicRead = await withCache({ cacheKey: key, tags: entryTags, fn: async () => 'public' })
    expect(publicRead).toBe('public')
  })
})
