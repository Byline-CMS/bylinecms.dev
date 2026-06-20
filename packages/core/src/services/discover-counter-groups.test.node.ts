/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { discoverCounterGroups } from './discover-counter-groups.js'
import type { CollectionDefinition, IDbAdapter } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAdapter(options?: {
  ensure?: (group: string) => Promise<{ groupName: string; sequenceName: string }>
}) {
  const ensureCounterGroup = vi.fn(
    options?.ensure ??
      (async (groupName: string) => ({
        groupName,
        sequenceName: `byline_cseq_${groupName.replace(/-/g, '_')}_abcd1234`,
      }))
  )
  const fail = () => {
    throw new Error('unexpected call')
  }
  const db: IDbAdapter = {
    commands: {
      collections: { create: vi.fn(fail), update: vi.fn(fail), delete: vi.fn(fail) },
      documents: {
        createDocumentVersion: vi.fn(fail) as any,
        updateDocumentPath: vi.fn(fail) as any,
        setDocumentAvailableLocales: vi.fn(fail) as any,
        setDocumentStatus: vi.fn(fail),
        archivePublishedVersions: vi.fn(fail) as any,
        softDeleteDocument: vi.fn(fail) as any,
        deleteDocumentLocale: vi.fn(fail) as any,
        setOrderKey: vi.fn(fail) as any,
        placeTreeNode: vi.fn(fail) as any,
        removeFromTree: vi.fn(fail) as any,
      },
      counters: {
        ensureCounterGroup,
        nextCounterValue: vi.fn(fail) as any,
      },
    },
    queries: {
      collections: {
        getAllCollections: vi.fn(fail),
        getCollectionByPath: vi.fn(fail),
        getCollectionById: vi.fn(fail),
      },
      documents: {
        getDocumentById: vi.fn(fail),
        getCurrentVersionMetadata: vi.fn(fail) as any,
        getCurrentPath: vi.fn(fail) as any,
        getDocumentByPath: vi.fn(fail),
        getDocumentByVersion: vi.fn(fail),
        getDocumentsByVersionIds: vi.fn(fail),
        getDocumentsByDocumentIds: vi.fn(fail),
        getDocumentHistory: vi.fn(fail),
        getPublishedVersion: vi.fn(fail),
        getPublishedDocumentIds: vi.fn(fail),
        getDocumentCountsByStatus: vi.fn(fail) as any,
        findDocuments: vi.fn(fail) as any,
        getLastOrderKey: vi.fn(fail) as any,
        getNeighborOrderKeys: vi.fn(fail) as any,
        getCanonicalDocumentOrder: vi.fn(fail) as any,
        getTreeAncestors: vi.fn(fail) as any,
        getTreeChildren: vi.fn(fail) as any,
        getTreeSubtree: vi.fn(fail) as any,
      },
    },
  }
  return { db, ensureCounterGroup }
}

function collection(path: string, fields: CollectionDefinition['fields']): CollectionDefinition {
  return {
    path,
    labels: { singular: path, plural: `${path}s` },
    fields,
    workflow: {
      statuses: [{ name: 'draft' }, { name: 'published' }, { name: 'archived' }],
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discoverCounterGroups', () => {
  it('is a no-op when no collections declare any counter fields', async () => {
    const { db, ensureCounterGroup } = makeAdapter()
    const collections = [
      collection('news', [{ name: 'title', type: 'text' }]),
      collection('pages', [{ name: 'body', type: 'textArea' }]),
    ]
    const result = await discoverCounterGroups({ definitions: collections, db })
    expect(result.size).toBe(0)
    expect(ensureCounterGroup).not.toHaveBeenCalled()
  })

  it('registers each distinct group exactly once across all collections', async () => {
    const { db, ensureCounterGroup } = makeAdapter()
    const collections = [
      collection('topics', [
        { name: 'label', type: 'text' },
        { name: 'facetId', type: 'counter', group: 'library-facets' },
      ]),
      collection('formats', [
        { name: 'label', type: 'text' },
        { name: 'facetId', type: 'counter', group: 'library-facets' },
      ]),
      collection('geography', [
        { name: 'label', type: 'text' },
        { name: 'facetId', type: 'counter', group: 'library-facets' },
      ]),
    ]
    const result = await discoverCounterGroups({ definitions: collections, db })

    expect(result.size).toBe(1)
    expect(result.get('library-facets')).toMatch(/^byline_cseq_library_facets_/)
    expect(ensureCounterGroup).toHaveBeenCalledTimes(1)
    expect(ensureCounterGroup).toHaveBeenCalledWith('library-facets')
  })

  it('registers multiple distinct groups in a single pass', async () => {
    const { db, ensureCounterGroup } = makeAdapter()
    const collections = [
      collection('topics', [{ name: 'facetId', type: 'counter', group: 'library-facets' }]),
      collection('regions', [{ name: 'regionId', type: 'counter', group: 'region-codes' }]),
    ]
    const result = await discoverCounterGroups({ definitions: collections, db })

    expect(result.size).toBe(2)
    expect(ensureCounterGroup).toHaveBeenCalledTimes(2)
    expect(ensureCounterGroup).toHaveBeenCalledWith('library-facets')
    expect(ensureCounterGroup).toHaveBeenCalledWith('region-codes')
  })

  it('descends into group fields — counter inside a non-repeating group is allowed', async () => {
    const { db, ensureCounterGroup } = makeAdapter()
    const collections = [
      collection('topics', [
        {
          name: 'meta',
          type: 'group',
          fields: [
            { name: 'label', type: 'text' },
            { name: 'facetId', type: 'counter', group: 'library-facets' },
          ],
        },
      ]),
    ]
    const result = await discoverCounterGroups({ definitions: collections, db })

    expect(result.size).toBe(1)
    expect(ensureCounterGroup).toHaveBeenCalledWith('library-facets')
  })

  it('throws when a counter sits inside an array field', async () => {
    const { db, ensureCounterGroup } = makeAdapter()
    const collections = [
      collection('topics', [
        {
          name: 'variants',
          type: 'array',
          fields: [{ name: 'facetId', type: 'counter', group: 'library-facets' }],
        },
      ]),
    ]
    await expect(discoverCounterGroups({ definitions: collections, db })).rejects.toThrow(
      /nested inside a array field/
    )
    expect(ensureCounterGroup).not.toHaveBeenCalled()
  })

  it('throws when a counter sits inside a blocks field', async () => {
    const { db, ensureCounterGroup } = makeAdapter()
    const collections = [
      collection('topics', [
        {
          name: 'content',
          type: 'blocks',
          blocks: [
            {
              blockType: 'tagBlock',
              fields: [{ name: 'facetId', type: 'counter', group: 'library-facets' }],
            } as any,
          ],
        },
      ]),
    ]
    await expect(discoverCounterGroups({ definitions: collections, db })).rejects.toThrow(
      /nested inside a blocks field/
    )
    expect(ensureCounterGroup).not.toHaveBeenCalled()
  })

  it('surfaces the adapter error when ensureCounterGroup fails', async () => {
    const { db } = makeAdapter({
      ensure: async () => {
        throw new Error('sequence ddl rejected')
      },
    })
    const collections = [
      collection('topics', [{ name: 'facetId', type: 'counter', group: 'library-facets' }]),
    ]
    await expect(discoverCounterGroups({ definitions: collections, db })).rejects.toThrow(
      'sequence ddl rejected'
    )
  })
})
