/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { ErrorCodes } from '../lib/errors.js'
import { backfillStoredFileIdentity } from './stored-files-server.js'
import type {
  IDbAdapter,
  IStoredFileCommands,
  IStoredFileQueries,
  ListStoredFilePathsParams,
  StoredFilePathGroup,
} from '../@types/db-types.js'
import type { IStorageProvider, StorageValidator } from '../@types/storage-types.js'

const sha = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex')

interface FakeRow {
  storageProvider: string
  storagePath: string
  collectionId: string
  fileHash: string | null
  validator: StorageValidator | null
}

/** In-memory adapter with the documented paging and update semantics. */
function fakeDb(rows: FakeRow[], collections: Record<string, string> = { media: 'col-media' }) {
  const matches = (row: FakeRow, p: { storageProvider: string; collectionId?: string }) =>
    row.storageProvider === p.storageProvider &&
    (p.collectionId === undefined || row.collectionId === p.collectionId)

  const queries: IStoredFileQueries = {
    async listStoredFilePaths(p: ListStoredFilePathsParams): Promise<StoredFilePathGroup[]> {
      const selected = rows.filter(
        (row) =>
          matches(row, p) &&
          (p.identity === 'missing' ? row.fileHash === null : row.fileHash !== null) &&
          (p.afterPath === undefined || row.storagePath > p.afterPath)
      )
      const paths = [...new Set(selected.map((row) => row.storagePath))].sort().slice(0, p.limit)
      return paths.map((storagePath) => {
        if (p.identity === 'missing') return { storagePath, hashes: [] }
        const counts = new Map<string, number>()
        for (const row of selected) {
          if (row.storagePath === storagePath && row.fileHash) {
            counts.set(row.fileHash, (counts.get(row.fileHash) ?? 0) + 1)
          }
        }
        return {
          storagePath,
          hashes: [...counts].sort().map(([fileHash, rowCount]) => ({ fileHash, rowCount })),
        }
      })
    },
  }
  const setIdentityForPath = vi.fn<IStoredFileCommands['setIdentityForPath']>(async (p) => {
    let updated = 0
    for (const row of rows) {
      if (matches(row, p) && row.storagePath === p.storagePath && row.fileHash === null) {
        row.fileHash = p.fileHash
        row.validator = p.storageValidator
        updated += 1
      }
    }
    return updated
  })
  const db = {
    commands: { storedFiles: { setIdentityForPath } },
    queries: {
      storedFiles: queries,
      collections: {
        getCollectionByPath: async (path: string) =>
          collections[path] ? { id: collections[path], path } : null,
      },
    },
  } as unknown as IDbAdapter
  return { db, setIdentityForPath }
}

/** A provider whose objects are in-memory strings; `download` is a bound read. */
function fakeStorage(objects: Record<string, string>, options?: { failOn?: string[] }) {
  const download = vi.fn(async (storagePath: string) => {
    if (options?.failOn?.includes(storagePath)) throw new Error(`read failed: ${storagePath}`)
    const content = objects[storagePath]
    if (content === undefined) return null
    return {
      body: Readable.from([Buffer.from(content)]),
      validator: { kind: 'test', value: `v:${storagePath}:${content.length}` },
      size: content.length,
    }
  })
  const storage: IStorageProvider = {
    providerName: 'local',
    upload: vi.fn(),
    delete: vi.fn(),
    getUrl: (p) => p,
    download,
  }
  return { storage, download }
}

const row = (storagePath: string, extra?: Partial<FakeRow>): FakeRow => ({
  storageProvider: 'local',
  storagePath,
  collectionId: 'col-media',
  fileHash: null,
  validator: null,
  ...extra,
})

describe('backfillStoredFileIdentity — fill', () => {
  it('reads each path once and records hash and validator on every null row', async () => {
    const rows = [row('media/a.pdf'), row('media/a.pdf'), row('media/b.pdf')]
    const { db } = fakeDb(rows)
    const { storage, download } = fakeStorage({ 'media/a.pdf': 'AAA', 'media/b.pdf': 'BB' })

    const summary = await backfillStoredFileIdentity({ db, storage })

    expect(summary).toMatchObject({ mode: 'fill', scanned: 2, hashed: 2, rowsUpdated: 3 })
    expect(download).toHaveBeenCalledTimes(2)
    expect(rows.map((r) => r.fileHash)).toEqual([sha('AAA'), sha('AAA'), sha('BB')])
    expect(rows[0]?.validator).toEqual({ kind: 'test', value: 'v:media/a.pdf:3' })
  })

  it('makes no changes on a second run', async () => {
    const rows = [row('media/a.pdf')]
    const { db, setIdentityForPath } = fakeDb(rows)
    const { storage } = fakeStorage({ 'media/a.pdf': 'AAA' })

    await backfillStoredFileIdentity({ db, storage })
    setIdentityForPath.mockClear()
    const again = await backfillStoredFileIdentity({ db, storage })

    expect(again).toMatchObject({ scanned: 0, rowsUpdated: 0 })
    expect(setIdentityForPath).not.toHaveBeenCalled()
  })

  it('never overwrites a recorded hash', async () => {
    const rows = [row('media/a.pdf', { fileHash: sha('OLD') }), row('media/a.pdf')]
    const { db } = fakeDb(rows)
    const { storage } = fakeStorage({ 'media/a.pdf': 'NEW' })

    await backfillStoredFileIdentity({ db, storage })

    expect(rows.map((r) => r.fileHash)).toEqual([sha('OLD'), sha('NEW')])
  })

  it('resumes cleanly after a run stopped by its limit', async () => {
    const rows = [row('media/a.pdf'), row('media/b.pdf'), row('media/c.pdf')]
    const { db } = fakeDb(rows)
    const { storage } = fakeStorage({ 'media/a.pdf': 'A', 'media/b.pdf': 'B', 'media/c.pdf': 'C' })

    const first = await backfillStoredFileIdentity({ db, storage, limit: 1, batchSize: 1 })
    const rest = await backfillStoredFileIdentity({ db, storage, batchSize: 1 })

    expect(first.scanned).toBe(1)
    expect(rest.scanned).toBe(2)
    expect(rows.every((r) => r.fileHash !== null)).toBe(true)
  })

  it('leaves missing and unreadable objects without identity and reports them', async () => {
    const rows = [row('media/gone.pdf'), row('media/bad.pdf'), row('media/ok.pdf')]
    const { db } = fakeDb(rows)
    const { storage } = fakeStorage(
      { 'media/bad.pdf': 'x', 'media/ok.pdf': 'ok' },
      { failOn: ['media/bad.pdf'] }
    )

    const summary = await backfillStoredFileIdentity({ db, storage })

    expect(summary).toMatchObject({ scanned: 3, hashed: 1, missing: 1, failed: 1, rowsUpdated: 1 })
    expect(summary.missingPaths).toEqual(['media/gone.pdf'])
    expect(summary.failures).toEqual([
      { storagePath: 'media/bad.pdf', error: 'read failed: media/bad.pdf' },
    ])
    expect(rows.map((r) => r.fileHash === null)).toEqual([true, true, false])
  })

  it('writes nothing in a dry run', async () => {
    const rows = [row('media/a.pdf')]
    const { db, setIdentityForPath } = fakeDb(rows)
    const { storage } = fakeStorage({ 'media/a.pdf': 'AAA' })

    const summary = await backfillStoredFileIdentity({ db, storage, dryRun: true })

    expect(summary).toMatchObject({ dryRun: true, scanned: 1, hashed: 1, rowsUpdated: 0 })
    expect(setIdentityForPath).not.toHaveBeenCalled()
    expect(rows[0]?.fileHash).toBeNull()
  })

  it('selects only rows written by the configured provider', async () => {
    const rows = [row('media/a.pdf'), row('media/a.pdf', { storageProvider: 's3' })]
    const { db } = fakeDb(rows)
    const { storage } = fakeStorage({ 'media/a.pdf': 'AAA' })

    await backfillStoredFileIdentity({ db, storage })

    expect(rows.map((r) => r.fileHash)).toEqual([sha('AAA'), null])
  })

  it('confines a collection-scoped run to that collection', async () => {
    const rows = [row('shared/a.pdf'), row('shared/a.pdf', { collectionId: 'col-docs' })]
    const { db } = fakeDb(rows, { media: 'col-media', docs: 'col-docs' })
    const { storage } = fakeStorage({ 'shared/a.pdf': 'AAA' })

    const summary = await backfillStoredFileIdentity({ db, storage, collectionPath: 'media' })

    expect(summary.rowsUpdated).toBe(1)
    expect(rows.map((r) => r.fileHash)).toEqual([sha('AAA'), null])
  })
})

describe('backfillStoredFileIdentity — refusals', () => {
  it('refuses a provider without download', async () => {
    const { db } = fakeDb([row('media/a.pdf')])
    const { storage } = fakeStorage({})
    delete storage.download

    await expect(backfillStoredFileIdentity({ db, storage })).rejects.toMatchObject({
      code: ErrorCodes.STORAGE,
      details: expect.objectContaining({ reason: 'download-unavailable' }),
    })
  })

  it('refuses an adapter without stored-file maintenance', async () => {
    const { storage } = fakeStorage({})
    const db = { commands: {}, queries: {} } as unknown as IDbAdapter

    await expect(backfillStoredFileIdentity({ db, storage })).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
      details: expect.objectContaining({ reason: 'adapter-unsupported' }),
    })
  })

  it('rejects an unknown collection path', async () => {
    const { db } = fakeDb([row('media/a.pdf')])
    const { storage } = fakeStorage({})

    await expect(
      backfillStoredFileIdentity({ db, storage, collectionPath: 'nope' })
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
      details: expect.objectContaining({ reason: 'unknown-collection' }),
    })
  })
})

describe('backfillStoredFileIdentity — verify', () => {
  it('reports matched and mismatched hash groups and writes nothing', async () => {
    const rows = [
      row('media/a.pdf', { fileHash: sha('AAA') }),
      row('media/b.pdf', { fileHash: sha('STALE') }),
      row('media/c.pdf'),
    ]
    const { db, setIdentityForPath } = fakeDb(rows)
    const { storage } = fakeStorage({ 'media/a.pdf': 'AAA', 'media/b.pdf': 'CURRENT' })

    const summary = await backfillStoredFileIdentity({ db, storage, mode: 'verify' })

    expect(summary).toMatchObject({ mode: 'verify', scanned: 2, matched: 1, mismatched: 1 })
    expect(summary.mismatches).toEqual([
      {
        storagePath: 'media/b.pdf',
        recordedHash: sha('STALE'),
        currentHash: sha('CURRENT'),
        rowCount: 1,
      },
    ])
    expect(setIdentityForPath).not.toHaveBeenCalled()
    expect(rows[2]?.fileHash).toBeNull()
  })

  it('pages by whole paths: batchSize 1 reports every hash group on a multi-hash path', async () => {
    // The first path carries two different recorded hashes (an older version
    // recorded bytes later replaced at the same path); another path follows.
    // A row of the same object in another collection must not be touched.
    const rows = [
      row('media/a.pdf', { fileHash: sha('OLD') }),
      row('media/a.pdf', { fileHash: sha('NEW') }),
      row('media/a.pdf', { fileHash: sha('NEW') }),
      row('media/b.pdf', { fileHash: sha('B') }),
      row('media/a.pdf', { collectionId: 'col-docs' }),
    ]
    const before = structuredClone(rows)
    const { db, setIdentityForPath } = fakeDb(rows, { media: 'col-media', docs: 'col-docs' })
    const { storage, download } = fakeStorage({ 'media/a.pdf': 'NEW', 'media/b.pdf': 'B' })

    const summary = await backfillStoredFileIdentity({
      db,
      storage,
      mode: 'verify',
      batchSize: 1,
      collectionPath: 'media',
    })

    expect(summary).toMatchObject({ scanned: 2, hashed: 2, matched: 2, mismatched: 1 })
    expect(summary.mismatches).toEqual([
      {
        storagePath: 'media/a.pdf',
        recordedHash: sha('OLD'),
        currentHash: sha('NEW'),
        rowCount: 1,
      },
    ])
    expect(download.mock.calls.map((call) => call[0])).toEqual(['media/a.pdf', 'media/b.pdf'])
    expect(setIdentityForPath).not.toHaveBeenCalled()
    expect(rows).toEqual(before)
  })
})
