/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { fingerprintCollection } from '../storage/collection-fingerprint.js'
import { ensureCollections } from './collection-bootstrap.js'
import type { CollectionDefinition, IDbAdapter } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseCollection(): CollectionDefinition {
  return {
    path: 'news',
    labels: { singular: 'News', plural: 'News' },
    fields: [{ name: 'title', type: 'text' }],
    workflow: {
      statuses: [{ name: 'draft' }, { name: 'published' }, { name: 'archived' }],
    },
  }
}

// Build a minimal IDbAdapter. We only wire the methods `ensureCollections`
// actually calls; the others throw if touched so we catch accidental usage.
function createMockDb(options: {
  existingRow?: { id: string; version: number; schema_hash: string | null } | null
}) {
  const getCollectionByPath = vi.fn().mockResolvedValue(options.existingRow ?? null)
  const create = vi
    .fn()
    .mockImplementation(async (_path: string, _config: CollectionDefinition, _opts: any) => [
      { id: 'col-new' },
    ])
  const update = vi.fn().mockResolvedValue([{ id: options.existingRow?.id ?? 'col-new' }])

  const fail = () => {
    throw new Error('not expected to be called')
  }

  const db: IDbAdapter = {
    commands: {
      collections: { create, update, delete: vi.fn(fail) },
      documents: {
        createDocumentVersion: vi.fn(fail) as any,
        setDocumentStatus: vi.fn(fail),
        archivePublishedVersions: vi.fn(fail) as any,
        softDeleteDocument: vi.fn(fail) as any,
      },
    },
    queries: {
      collections: {
        getAllCollections: vi.fn(fail),
        getCollectionByPath,
        getCollectionById: vi.fn(fail),
      },
      documents: {
        getDocumentById: vi.fn(fail),
        getCurrentVersionMetadata: vi.fn(fail) as any,
        getDocumentByPath: vi.fn(fail),
        getDocumentByVersion: vi.fn(fail),
        getDocumentsByVersionIds: vi.fn(fail),
        getDocumentsByDocumentIds: vi.fn(fail),
        getDocumentHistory: vi.fn(fail),
        getPublishedVersion: vi.fn(fail),
        getPublishedDocumentIds: vi.fn(fail),
        getDocumentCountsByStatus: vi.fn(fail),
        findDocuments: vi.fn(fail),
      },
    },
  }

  return { db, create, update, getCollectionByPath }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureCollections', () => {
  it('inserts a new row with version 1 and the schema fingerprint', async () => {
    const def = baseCollection()
    const { db, create, update } = createMockDb({ existingRow: null })

    const records = await ensureCollections({ definitions: [def], db })

    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    const [path, config, opts] = create.mock.calls[0]!
    expect(path).toBe('news')
    expect(config).toBe(def)
    const expectedHash = await fingerprintCollection(def)
    expect(opts).toEqual({ version: 1, schemaHash: expectedHash })

    expect(records.get('news')).toEqual({
      collectionId: 'col-new',
      version: 1,
      schemaHash: expectedHash,
    })
  })

  it('honours an explicit version pin on first insert', async () => {
    const def: CollectionDefinition = { ...baseCollection(), version: 5 }
    const { db, create } = createMockDb({ existingRow: null })

    await ensureCollections({ definitions: [def], db })

    const [, , opts] = create.mock.calls[0]!
    expect(opts.version).toBe(5)
  })

  it('is a no-op when the stored hash matches the current fingerprint', async () => {
    const def = baseCollection()
    const hash = await fingerprintCollection(def)
    const { db, create, update } = createMockDb({
      existingRow: { id: 'col-1', version: 3, schema_hash: hash },
    })

    const records = await ensureCollections({ definitions: [def], db })

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(records.get('news')).toEqual({
      collectionId: 'col-1',
      version: 3,
      schemaHash: hash,
    })
  })

  it('auto-bumps the version when the fingerprint changes', async () => {
    const def = baseCollection()
    // Seed the DB with a mismatched hash.
    const { db, update } = createMockDb({
      existingRow: { id: 'col-1', version: 3, schema_hash: 'stale-hash' },
    })

    const records = await ensureCollections({ definitions: [def], db })

    expect(update).toHaveBeenCalledTimes(1)
    const [id, patch] = update.mock.calls[0]!
    expect(id).toBe('col-1')
    expect(patch).toEqual({
      config: def,
      version: 4,
      schemaHash: await fingerprintCollection(def),
    })
    expect(records.get('news')?.version).toBe(4)
  })

  it('uses an explicit pin on update when >= the stored version', async () => {
    const def: CollectionDefinition = { ...baseCollection(), version: 9 }
    const { db, update } = createMockDb({
      existingRow: { id: 'col-1', version: 3, schema_hash: 'stale' },
    })

    const records = await ensureCollections({ definitions: [def], db })

    expect(update.mock.calls[0]?.[1].version).toBe(9)
    expect(records.get('news')?.version).toBe(9)
  })

  it('throws when an explicit pin is less than the stored version', async () => {
    const def: CollectionDefinition = { ...baseCollection(), version: 2 }
    const { db } = createMockDb({
      existingRow: { id: 'col-1', version: 5, schema_hash: 'stale' },
    })

    await expect(ensureCollections({ definitions: [def], db })).rejects.toThrow(/backwards/i)
  })

  it('backfills schema_hash without bumping when stored hash is null', async () => {
    const def = baseCollection()
    const { db, update } = createMockDb({
      existingRow: { id: 'col-1', version: 3, schema_hash: null },
    })

    const records = await ensureCollections({ definitions: [def], db })

    expect(update).toHaveBeenCalledTimes(1)
    const [, patch] = update.mock.calls[0]!
    expect(patch.version).toBe(3) // unchanged
    expect(patch.schemaHash).toBe(await fingerprintCollection(def))
    expect(records.get('news')?.version).toBe(3)
  })

  it('reconciles multiple collections in one pass', async () => {
    const a = baseCollection()
    const b: CollectionDefinition = { ...baseCollection(), path: 'pages' }

    const hashA = await fingerprintCollection(a)
    // For `a` the DB matches; for `b` it does not exist yet.
    const getCollectionByPath = vi.fn(async (path: string) => {
      if (path === 'news') return { id: 'col-news', version: 2, schema_hash: hashA }
      return null
    })
    const create = vi.fn().mockResolvedValue([{ id: 'col-pages' }])
    const update = vi.fn()

    const db: IDbAdapter = {
      commands: {
        collections: { create, update, delete: vi.fn() },
        documents: {
          createDocumentVersion: vi.fn() as any,
          setDocumentStatus: vi.fn(),
          archivePublishedVersions: vi.fn() as any,
          softDeleteDocument: vi.fn() as any,
        },
      },
      queries: {
        collections: {
          getAllCollections: vi.fn(),
          getCollectionByPath,
          getCollectionById: vi.fn(),
        },
        documents: {
          getDocumentById: vi.fn(),
          getCurrentVersionMetadata: vi.fn() as any,
          getDocumentByPath: vi.fn(),
          getDocumentByVersion: vi.fn(),
          getDocumentsByVersionIds: vi.fn(),
          getDocumentsByDocumentIds: vi.fn(),
          getDocumentHistory: vi.fn(),
          getPublishedVersion: vi.fn(),
          getPublishedDocumentIds: vi.fn(),
          getDocumentCountsByStatus: vi.fn(),
          findDocuments: vi.fn(),
        },
      },
    }

    const records = await ensureCollections({ definitions: [a, b], db })

    expect(records.get('news')?.version).toBe(2)
    expect(records.get('pages')?.version).toBe(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})
