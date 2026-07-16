/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'

import type { SystemFieldsChangeContext } from '@byline/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@byline/core', () => ({
  defineHooks: <T>(hooks: T) => hooks,
}))

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
vi.mock('@byline/client/server', () => ({
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

  it.each([
    ['docs', docsHooks, { prevPath: 'same-path', list: true, sitemap: true }],
    ['news', newsHooks, { prevPath: 'same-path', list: true, sitemap: true }],
    ['pages', pagesHooks, { prevPath: 'same-path', sitemap: true }],
  ] as const)('%s invalidates public locale surfaces without reindexing', async (collectionPath, hooks, options) => {
    await invokeHook(hooks.afterSystemFieldsChange, {
      documentId: 'doc-1',
      collectionPath,
      requested: { path: false, availableLocales: true },
      changed: { path: false, availableLocales: true },
      reconciliation: false,
      previousPath: 'same-path',
      currentPath: 'same-path',
      previousAvailableLocales: ['en'],
      currentAvailableLocales: ['en', 'fr'],
    })

    expect(cache.invalidateDocument).toHaveBeenCalledWith(collectionPath, 'same-path', options)
    expect(search.indexDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['docs', docsHooks],
    ['news', newsHooks],
    ['pages', pagesHooks],
  ] as const)('%s uses a collection sweep and reindex for path reconciliation', async (collectionPath, hooks) => {
    await invokeHook(hooks.afterSystemFieldsChange, {
      documentId: 'doc-1',
      collectionPath,
      requested: { path: true, availableLocales: false },
      changed: { path: false, availableLocales: false },
      reconciliation: true,
      previousPath: 'current-path',
      currentPath: 'current-path',
      previousAvailableLocales: ['en'],
      currentAvailableLocales: ['en'],
    })

    expect(cache.invalidateCollection).toHaveBeenCalledWith(collectionPath)
    expect(cache.invalidateDocument).not.toHaveBeenCalled()
    expect(search.indexDocument).toHaveBeenCalledOnce()
  })

  it.each([
    ['docs', docsHooks, { list: true, sitemap: true }],
    ['news', newsHooks, { list: true, sitemap: true }],
    ['pages', pagesHooks, { sitemap: true }],
  ] as const)('%s preserves structural invalidation for create, status, and unpublish', async (collectionPath, hooks, options) => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    await invokeHook(hooks.afterCreate, {
      data: {},
      collectionPath,
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      path: 'path',
    })
    expect(cache.invalidateDocument).toHaveBeenLastCalledWith(collectionPath, 'path', options)
    expect(cache.invalidateDocument).toHaveBeenCalledTimes(1)
    expect(search.indexDocument).toHaveBeenCalledTimes(1)

    await invokeHook(hooks.afterStatusChange, {
      collectionPath,
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      path: 'path',
      previousStatus: 'draft',
      nextStatus: 'published',
    })
    expect(cache.invalidateDocument).toHaveBeenLastCalledWith(collectionPath, 'path', options)
    expect(cache.invalidateDocument).toHaveBeenCalledTimes(2)
    expect(search.indexDocument).toHaveBeenCalledTimes(2)

    await invokeHook(hooks.afterUnpublish, {
      collectionPath,
      documentId: 'doc-1',
      path: 'path',
      archivedCount: 1,
    })
    expect(cache.invalidateDocument).toHaveBeenLastCalledWith(collectionPath, 'path', options)
    expect(cache.invalidateDocument).toHaveBeenCalledTimes(3)
    expect(search.indexDocument).toHaveBeenCalledTimes(3)
    consoleLog.mockRestore()
  })

  it.each([
    ['docs', docsHooks, { list: true, sitemap: true }],
    ['news', newsHooks, { list: true, sitemap: true }],
    ['pages', pagesHooks, { sitemap: true }],
  ] as const)('%s removes search and structurally invalidates after deletion', async (collectionPath, hooks, options) => {
    await invokeHook(hooks.afterDelete, {
      documentId: 'doc-1',
      collectionPath,
      path: 'deleted-path',
    })

    expect(search.collection).toHaveBeenCalledWith(collectionPath)
    expect(search.removeFromIndex).toHaveBeenCalledWith('doc-1')
    expect(cache.invalidateDocument).toHaveBeenCalledWith(collectionPath, 'deleted-path', options)
    expect(search.removeFromIndex.mock.invocationCallOrder[0]).toBeLessThan(
      cache.invalidateDocument.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
  })

  it.each([
    ['docs', docsHooks, { prevPath: 'old-path', list: true }],
    ['news', newsHooks, { prevPath: 'old-path', list: true }],
    ['pages', pagesHooks, { prevPath: 'old-path' }],
  ] as const)('%s invalidates previous paths and reindexes ordinary updates', async (collectionPath, hooks, options) => {
    await invokeHook(hooks.afterUpdate, {
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      collectionPath,
      path: 'new-path',
      data: {},
      originalData: { path: 'old-path' },
    })

    expect(cache.invalidateDocument).toHaveBeenCalledWith(collectionPath, 'new-path', options)
    expect(search.indexDocument).toHaveBeenCalledWith('doc-1')
  })

  it('starts search reconciliation even when cache invalidation rejects', async () => {
    const cacheFailure = new Error('cache failed')
    cache.invalidateDocument.mockRejectedValueOnce(cacheFailure)

    await expect(
      invokeHook(newsHooks.afterUpdate, {
        documentId: 'news-1',
        documentVersionId: 'version-1',
        collectionPath: 'news',
        path: 'new-path',
        data: {},
        originalData: { path: 'old-path' },
      })
    ).rejects.toBe(cacheFailure)

    expect(cache.invalidateDocument).toHaveBeenCalledOnce()
    expect(search.indexDocument).toHaveBeenCalledOnce()
  })

  it('starts delete cache invalidation even when search removal rejects', async () => {
    const searchFailure = new Error('search failed')
    search.removeFromIndex.mockRejectedValueOnce(searchFailure)

    await expect(
      invokeHook(pagesHooks.afterDelete, {
        documentId: 'page-1',
        collectionPath: 'pages',
        path: 'page',
      })
    ).rejects.toBe(searchFailure)

    expect(search.removeFromIndex).toHaveBeenCalledWith('page-1')
    expect(cache.invalidateDocument).toHaveBeenCalledWith('pages', 'page', { sitemap: true })
    expect(search.removeFromIndex.mock.invocationCallOrder[0]).toBeLessThan(
      cache.invalidateDocument.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
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

  it('retains docs fingerprint logging on create', async () => {
    const data = { title: 'Factory extraction' }
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    await invokeHook(docsHooks.afterCreate, {
      data,
      collectionPath: 'docs',
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      path: 'factory-extraction',
    })

    expect(consoleLog).toHaveBeenCalledWith(
      `afterCreate: document doc-1 created in 'docs' (content fingerprint ${fingerprint})`
    )
    consoleLog.mockRestore()
  })

  it('retains docs tree-wide invalidation only for docs', async () => {
    await invokeHook(docsHooks.afterTreeChange, {
      collectionPath: 'docs',
      change: 'place',
      documentId: 'doc-1',
      affectedDocumentIds: ['doc-1'],
    })

    expect(cache.invalidateCollection).toHaveBeenCalledWith('docs')
    expect(newsHooks.afterTreeChange).toBeUndefined()
    expect(pagesHooks.afterTreeChange).toBeUndefined()
  })
})
