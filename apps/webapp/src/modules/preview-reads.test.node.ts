/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Every preview-aware read in the reference app derives both version selection
 * and locale visibility from the verified preview state. With preview off
 * (anonymous, signed out, expired, or a cookie without a session, which
 * `isPreviewActive()` all report as `false`), reads are published and public.
 * With preview on, they read the latest version with editorial visibility, and
 * detail results carry no draft-derived public discovery metadata.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  preview: false,
  calls: [] as Array<{ collection: string; method: string; args: unknown[] }>,
}))

const draftDoc = {
  id: 'doc-1',
  path: 'launch',
  sourceLocale: 'en',
  availableLocales: ['en', 'es'],
  _availableVersionLocales: ['en', 'es'],
  fields: { title: 'Lanzamiento', area: 'about' },
}

vi.mock('@byline/client/server', () => {
  const record =
    (collection: string, method: string, result: unknown) =>
    async (...args: unknown[]) => {
      state.calls.push({ collection, method, args })
      return result
    }
  return {
    isPreviewActive: async () => state.preview,
    getViewerBylineClient: () => ({
      collection: (collection: string) => ({
        findByPath: record(collection, 'findByPath', { ...draftDoc }),
        find: record(collection, 'find', { docs: [], meta: {} }),
        getAncestors: record(collection, 'getAncestors', []),
        getTreeParent: record(collection, 'getTreeParent', {
          placed: false,
          parentDocumentId: null,
        }),
        getSubtree: record(collection, 'getSubtree', []),
      }),
    }),
  }
})

vi.mock('@/lib/cache/with-cache', () => ({
  withCache: ({ fn }: { fn: () => unknown }) => fn(),
  cacheKeys: {
    details: (...parts: unknown[]) => parts.join(':'),
    list: (...parts: unknown[]) => parts.join(':'),
  },
  tags: {
    collection: (c: string) => c,
    details: (c: string, p: string) => `${c}:${p}`,
    list: (c: string) => c,
  },
}))

type ReadOptions = { status?: string; localeVisibility?: string }

function readOptions(): Array<{ read: string; options: ReadOptions }> {
  return state.calls.map(({ collection, method, args }) => ({
    read: `${collection}.${method}`,
    options: (method === 'find' || method === 'getSubtree' ? args[0] : args[1]) as ReadOptions,
  }))
}

async function runEveryPreviewAwareRead() {
  const [docsDetails, docsNav, newsDetails, newsList, newsCategories, pagesDetails] =
    await Promise.all([
      import('./docs/details.server.js'),
      import('./docs/nav.server.js'),
      import('./news/details.server.js'),
      import('./news/list.server.js'),
      import('./news/categories.server.js'),
      import('./pages/details.server.js'),
    ])
  const results = {
    doc: await docsDetails.getDocBySplat({ splat: 'launch', lng: 'es' }),
    news: await newsDetails.getNewsDetails({ path: 'launch', lng: 'es' }),
    page: await pagesDetails.getPageDetails({ path: 'launch', lng: 'es' }),
  }
  await docsNav.getDocsNav({ lng: 'es' })
  await newsList.getNewsList({ lng: 'es', page: 1, pageSize: 10 } as never)
  await newsCategories.getNewsCategories({ lng: 'es' })
  await pagesDetails.getPagePath('launch')
  return results
}

describe('preview-aware reads', () => {
  beforeEach(() => {
    state.calls.length = 0
  })
  afterEach(() => {
    state.preview = false
  })

  it('reads published content with public visibility when preview is not active', async () => {
    state.preview = false
    const results = await runEveryPreviewAwareRead()

    const reads = readOptions()
    expect(reads.map((r) => r.read)).toEqual(
      expect.arrayContaining([
        'docs.findByPath',
        'docs.getAncestors',
        'docs.getTreeParent',
        'news.findByPath',
        'pages.findByPath',
        'docs.getSubtree',
        'news.find',
        'news-categories.find',
      ])
    )
    for (const { read, options } of reads) {
      expect({ read, ...options }).toMatchObject({
        read,
        status: 'published',
        localeVisibility: 'public',
      })
    }
    // Public results keep their metadata: public discovery is computed from it.
    expect(results.news?._availableVersionLocales).toEqual(['en', 'es'])
    expect(results.page?._availableVersionLocales).toEqual(['en', 'es'])
    expect(results.doc?.doc._availableVersionLocales).toEqual(['en', 'es'])
  })

  it('reads the latest version with editorial visibility when preview is active', async () => {
    state.preview = true
    const results = await runEveryPreviewAwareRead()

    const reads = readOptions()
    // Preview shows the full tree, so there is no public spine check.
    expect(reads.map((r) => r.read)).not.toContain('docs.getTreeParent')
    for (const { read, options } of reads) {
      expect({ read, ...options }).toMatchObject({
        read,
        status: 'any',
        localeVisibility: 'editorial',
      })
    }
    // The translation is served; draft completeness is not advertised.
    expect(results.news?.fields.title).toBe('Lanzamiento')
    expect(results.news?._availableVersionLocales).toEqual([])
    expect(results.page?._availableVersionLocales).toEqual([])
    expect(results.doc?.doc._availableVersionLocales).toEqual([])
  })
})
