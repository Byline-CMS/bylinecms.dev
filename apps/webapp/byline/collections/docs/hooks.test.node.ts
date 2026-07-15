/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SystemFieldsChangeContext } from '@byline/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cache = vi.hoisted(() => ({
  invalidateCollection: vi.fn(),
  invalidateDocument: vi.fn(),
}))

const search = vi.hoisted(() => ({
  collection: vi.fn(),
  indexDocument: vi.fn(),
  removeFromIndex: vi.fn(),
}))

vi.mock('@/lib/cache/with-cache', () => cache)
vi.mock('../../client.server.js', () => ({
  getSystemBylineClient: () => ({ collection: search.collection }),
}))

import newsHooks from '../news/hooks.js'
import pagesHooks from '../pages/hooks.js'
import docsHooks from './hooks.js'

async function invokeHook<Context>(
  hook:
    | ((context: Context) => void | Promise<void>)
    | Array<(context: Context) => void | Promise<void>>
    | undefined,
  context: Context
): Promise<void> {
  expect(hook).toBeDefined()
  if (hook == null) return
  for (const fn of Array.isArray(hook) ? hook : [hook]) await fn(context)
}

describe('public collection lifecycle hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cache.invalidateCollection.mockResolvedValue(undefined)
    cache.invalidateDocument.mockResolvedValue(undefined)
    search.indexDocument.mockResolvedValue(undefined)
    search.removeFromIndex.mockResolvedValue(undefined)
    search.collection.mockReturnValue({
      indexDocument: search.indexDocument,
      removeFromIndex: search.removeFromIndex,
    })
  })

  it.each([
    ['docs', docsHooks, { prevPath: 'old-path', list: true, sitemap: true }],
    ['news', newsHooks, { prevPath: 'old-path', list: true, sitemap: true }],
    ['pages', pagesHooks, { prevPath: 'old-path', sitemap: true }],
  ] as const)('%s invalidates path-dependent public surfaces and reindexes system-field changes', async (collectionPath, hooks, options) => {
    const context: SystemFieldsChangeContext = {
      documentId: 'doc-1',
      collectionPath,
      requested: { path: true, availableLocales: false },
      changed: { path: true, availableLocales: false },
      reconciliation: false,
      previousPath: 'old-path',
      currentPath: 'new-path',
      previousAvailableLocales: ['en'],
      currentAvailableLocales: ['en'],
    }

    await invokeHook(hooks.afterSystemFieldsChange, context)

    expect(cache.invalidateDocument).toHaveBeenCalledWith(collectionPath, 'new-path', options)
    expect(search.collection).toHaveBeenCalledWith(collectionPath)
    expect(search.indexDocument).toHaveBeenCalledWith('doc-1')
  })

  it('invalidates detail alternates and sitemap/llms data for locale advertisement changes', async () => {
    await invokeHook(docsHooks.afterSystemFieldsChange, {
      documentId: 'doc-1',
      collectionPath: 'docs',
      requested: { path: false, availableLocales: true },
      changed: { path: false, availableLocales: true },
      reconciliation: false,
      previousPath: 'same-path',
      currentPath: 'same-path',
      previousAvailableLocales: ['en'],
      currentAvailableLocales: ['en', 'fr'],
    })

    expect(cache.invalidateDocument).toHaveBeenCalledWith('docs', 'same-path', {
      prevPath: 'same-path',
      list: true,
      sitemap: true,
    })
    expect(search.indexDocument).not.toHaveBeenCalled()
  })

  it('uses a collection sweep and path reindex for no-op path reconciliation', async () => {
    await invokeHook(docsHooks.afterSystemFieldsChange, {
      documentId: 'doc-1',
      collectionPath: 'docs',
      requested: { path: true, availableLocales: false },
      changed: { path: false, availableLocales: false },
      reconciliation: true,
      previousPath: 'current-path',
      currentPath: 'current-path',
      previousAvailableLocales: ['en'],
      currentAvailableLocales: ['en'],
    })

    expect(cache.invalidateCollection).toHaveBeenCalledWith('docs')
    expect(cache.invalidateDocument).not.toHaveBeenCalled()
    expect(search.indexDocument).toHaveBeenCalledOnce()
  })

  it.each([
    ['docs', docsHooks],
    ['news', newsHooks],
    ['pages', pagesHooks],
  ] as const)('%s removes all search locales after deletion', async (collectionPath, hooks) => {
    await invokeHook(hooks.afterDelete, {
      documentId: 'doc-1',
      collectionPath,
      path: 'deleted-path',
    })

    expect(search.collection).toHaveBeenCalledWith(collectionPath)
    expect(search.removeFromIndex).toHaveBeenCalledWith('doc-1')
    expect(search.removeFromIndex.mock.invocationCallOrder[0]).toBeLessThan(
      cache.invalidateDocument.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
  })

  it('keeps news and pages search indexes synchronized on ordinary content updates', async () => {
    for (const [collectionPath, hooks] of [
      ['news', newsHooks],
      ['pages', pagesHooks],
    ] as const) {
      await invokeHook(hooks.afterUpdate, {
        documentId: `${collectionPath}-1`,
        documentVersionId: 'version-1',
        collectionPath,
        path: 'new-path',
        data: {},
        originalData: { path: 'old-path' },
      })
    }

    expect(search.indexDocument).toHaveBeenCalledWith('news-1')
    expect(search.indexDocument).toHaveBeenCalledWith('pages-1')
  })

  it('attempts cache and search independently and aggregates both failures', async () => {
    const cacheFailure = new Error('cache failed')
    const searchFailure = new Error('search failed')
    cache.invalidateDocument.mockRejectedValueOnce(cacheFailure)
    search.indexDocument.mockRejectedValueOnce(searchFailure)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await invokeHook(newsHooks.afterUpdate, {
        documentId: 'news-1',
        documentVersionId: 'version-1',
        collectionPath: 'news',
        path: 'new-path',
        data: {},
        originalData: { path: 'old-path' },
      })
    } catch (error) {
      caught = error
    }

    expect(cache.invalidateDocument).toHaveBeenCalledOnce()
    expect(search.indexDocument).toHaveBeenCalledOnce()
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([cacheFailure, searchFailure])
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('attempts search removal even when delete cache invalidation fails', async () => {
    cache.invalidateDocument.mockRejectedValueOnce(new Error('cache failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      invokeHook(pagesHooks.afterDelete, {
        documentId: 'page-1',
        collectionPath: 'pages',
        path: 'page',
      })
    ).rejects.toBeInstanceOf(AggregateError)

    expect(search.removeFromIndex).toHaveBeenCalledWith('page-1')
    expect(search.removeFromIndex.mock.invocationCallOrder[0]).toBeLessThan(
      cache.invalidateDocument.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
    consoleError.mockRestore()
  })

  it('does not duplicate search indexing for locale-only system plus content edits', async () => {
    await invokeHook(newsHooks.afterSystemFieldsChange, {
      documentId: 'news-1',
      collectionPath: 'news',
      requested: { path: false, availableLocales: true },
      changed: { path: false, availableLocales: true },
      reconciliation: false,
      previousPath: 'news',
      currentPath: 'news',
      previousAvailableLocales: ['en'],
      currentAvailableLocales: ['en', 'fr'],
    })
    await invokeHook(newsHooks.afterUpdate, {
      documentId: 'news-1',
      documentVersionId: 'version-1',
      collectionPath: 'news',
      path: 'news',
      data: {},
      originalData: { path: 'news' },
    })

    expect(search.indexDocument).toHaveBeenCalledTimes(1)
  })
})
