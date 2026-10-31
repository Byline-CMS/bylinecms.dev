/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter, StoredFileValue } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

/**
 * Stored-file content identity (spec 2026-10-31 §4.7–4.8): the validator
 * columns round-trip and survive version copies (including the Postgres
 * hand-written copy statements, which must also carry `variants`); restore
 * omits unknown identity; and the backfill primitives page by whole paths,
 * filter by provider and collection, and update only rows without a hash.
 */
export function storedFileIdentitySuite(hooks: ConformanceHooks): void {
  const ts = Date.now()
  const FilesCollection: CollectionDefinition = {
    path: `stored-file-identity-${ts}`,
    labels: { singular: 'File', plural: 'Files' },
    fields: [
      { name: 'title', type: 'text', localized: true },
      { name: 'attachment', type: 'file', optional: true },
      { name: 'image', type: 'image', optional: true },
    ],
  }
  const OtherCollection: CollectionDefinition = {
    path: `stored-file-identity-other-${ts}`,
    labels: { singular: 'Other', plural: 'Others' },
    fields: [{ name: 'attachment', type: 'file', optional: true }],
  }
  const HASH_A = 'a'.repeat(64)
  const HASH_B = 'b'.repeat(64)

  let adapter: IDbAdapter
  let filesId = ''
  let otherId = ''

  const file = (storagePath: string, extra?: Partial<StoredFileValue>): StoredFileValue => ({
    fileId: crypto.randomUUID(),
    filename: storagePath.split('/').pop() ?? 'file.bin',
    originalFilename: 'original.bin',
    mimeType: 'application/pdf',
    fileSize: 3,
    storageProvider: 'local',
    storagePath,
    processingStatus: 'complete',
    ...extra,
  })

  async function create(
    collection: CollectionDefinition,
    collectionId: string,
    documentData: Record<string, unknown>
  ) {
    return adapter.commands.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: collection,
      action: 'create',
      documentData,
      path: `doc-${crypto.randomUUID()}`,
    })
  }

  async function readAll(versionId: string) {
    const doc = await adapter.queries.documents.getDocumentByVersion({
      document_version_id: versionId,
      locale: 'all',
    })
    return doc?.fields as Record<string, any>
  }

  describe('stored-file identity', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([FilesCollection, OtherCollection])
      const files = await adapter.commands.collections.create(FilesCollection.path, FilesCollection)
      const other = await adapter.commands.collections.create(OtherCollection.path, OtherCollection)
      filesId = files[0]?.id as string
      otherId = other[0]?.id as string
      expect(adapter.queries.storedFiles).toBeDefined()
      expect(adapter.commands.storedFiles).toBeDefined()
    })

    afterAll(async () => {
      await adapter.commands.collections.delete(filesId).catch(() => undefined)
      await adapter.commands.collections.delete(otherId).catch(() => undefined)
    })

    it('round-trips fileHash and storageValidator', async () => {
      const created = await create(FilesCollection, filesId, {
        title: { en: 'Identity' },
        attachment: file('identity/roundtrip.pdf', {
          fileHash: HASH_A,
          storageValidator: { kind: 'local-stat', value: '1:2:3:3' },
        }),
      })

      const fields = await readAll(created.document.id)
      expect(fields.attachment).toMatchObject({
        fileHash: HASH_A,
        storageValidator: { kind: 'local-stat', value: '1:2:3:3' },
      })
    })

    it('omits unknown identity on read instead of returning null', async () => {
      const created = await create(FilesCollection, filesId, {
        title: { en: 'No identity' },
        attachment: file('identity/unknown.pdf'),
      })

      const attachment = (await readAll(created.document.id)).attachment
      expect('fileHash' in attachment).toBe(false)
      expect('storageValidator' in attachment).toBe(false)
    })

    // Upload fields are not localizable, so file rows are stored at locale
    // 'all'. Deleting a content locale mints a new version through the
    // adapter's full version copy, which must carry every file column —
    // including the validator pair and `variants`.
    it('carries identity and variants through a locale-deletion version copy', async () => {
      const variants = [{ name: 'card', storagePath: 'identity/card.webp', width: 320 }]
      const v1 = await create(FilesCollection, filesId, {
        title: { en: 'English', fr: 'Français' },
        image: file('identity/photo.png', {
          fileHash: HASH_B,
          storageValidator: { kind: 'local-stat', value: '9:9:9:3' },
          variants,
        }),
      })

      const deleted = await adapter.commands.documents.deleteDocumentLocale({
        documentId: v1.document.document_id,
        locale: 'fr',
      })
      expect(deleted).not.toBeNull()
      expect(deleted?.newVersionId).not.toBe(v1.document.id)

      const image = (await readAll(deleted?.newVersionId as string)).image
      expect(image).toMatchObject({
        storagePath: 'identity/photo.png',
        fileHash: HASH_B,
        storageValidator: { kind: 'local-stat', value: '9:9:9:3' },
      })
      expect(image.variants).toEqual([
        expect.objectContaining({ name: 'card', storagePath: 'identity/card.webp', width: 320 }),
      ])
    })

    describe('backfill primitives', () => {
      // Paths sort in byte order: 'paging/A.pdf' < 'paging/a.pdf' < 'paging/b.pdf'.
      beforeAll(async () => {
        await create(FilesCollection, filesId, {
          title: { en: 'p1' },
          attachment: file('paging/a.pdf'),
        })
        await create(FilesCollection, filesId, {
          title: { en: 'p2' },
          attachment: file('paging/a.pdf'),
        })
        await create(FilesCollection, filesId, {
          title: { en: 'p3' },
          attachment: file('paging/A.pdf'),
        })
        await create(FilesCollection, filesId, {
          title: { en: 'p4' },
          attachment: file('paging/b.pdf', { storageProvider: 's3' }),
        })
        await create(OtherCollection, otherId, { attachment: file('paging/a.pdf') })
        // Two recorded hashes on one path, then a later path.
        await create(FilesCollection, filesId, {
          title: { en: 'h1' },
          attachment: file('verify/multi.pdf', { fileHash: HASH_A }),
        })
        await create(FilesCollection, filesId, {
          title: { en: 'h2' },
          attachment: file('verify/multi.pdf', { fileHash: HASH_B }),
        })
        await create(FilesCollection, filesId, {
          title: { en: 'h3' },
          attachment: file('verify/multi.pdf', { fileHash: HASH_B }),
        })
        await create(FilesCollection, filesId, {
          title: { en: 'h4' },
          attachment: file('verify/zz.pdf', { fileHash: HASH_A }),
        })
      })

      const queries = () => {
        const q = adapter.queries.storedFiles
        if (!q) throw new Error('adapter lacks storedFiles queries')
        return q
      }
      const commands = () => {
        const c = adapter.commands.storedFiles
        if (!c) throw new Error('adapter lacks storedFiles commands')
        return c
      }

      it('lists distinct missing paths in byte order, keeping case-distinct paths apart', async () => {
        const page = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'missing',
          afterPath: 'paging/',
          limit: 10,
        })
        expect(page.map((g) => g.storagePath).filter((p) => p.startsWith('paging/'))).toEqual([
          'paging/A.pdf',
          'paging/a.pdf',
        ])
        expect(page.every((g) => g.hashes.length === 0)).toBe(true)
      })

      it('pages by path with a keyset cursor', async () => {
        const first = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'missing',
          afterPath: 'paging/',
          limit: 1,
        })
        const second = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'missing',
          afterPath: first[0]?.storagePath,
          limit: 1,
        })
        expect(first.map((g) => g.storagePath)).toEqual(['paging/A.pdf'])
        expect(second.map((g) => g.storagePath)).toEqual(['paging/a.pdf'])
      })

      it('filters by provider', async () => {
        const s3 = await queries().listStoredFilePaths({
          storageProvider: 's3',
          identity: 'missing',
          limit: 10,
        })
        expect(s3.map((g) => g.storagePath)).toEqual(['paging/b.pdf'])
      })

      it('returns every hash group of a path even when limit is 1', async () => {
        const page = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'present',
          afterPath: 'verify/',
          limit: 1,
        })
        expect(page).toEqual([
          {
            storagePath: 'verify/multi.pdf',
            hashes: [
              { fileHash: HASH_A, rowCount: 1 },
              { fileHash: HASH_B, rowCount: 2 },
            ],
          },
        ])
        const next = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'present',
          afterPath: 'verify/multi.pdf',
          limit: 1,
        })
        expect(next).toEqual([
          { storagePath: 'verify/zz.pdf', hashes: [{ fileHash: HASH_A, rowCount: 1 }] },
        ])
      })

      it('updates only null rows of the scoped collection, once', async () => {
        const validator = { kind: 'local-stat', value: '1:1:1:3' }
        const updated = await commands().setIdentityForPath({
          storageProvider: 'local',
          storagePath: 'paging/a.pdf',
          collectionId: filesId,
          fileHash: HASH_A,
          storageValidator: validator,
        })
        expect(updated).toBe(2)

        // Case-distinct path untouched; other collection's row still missing.
        const stillMissing = await queries().listStoredFilePaths({
          storageProvider: 'local',
          identity: 'missing',
          afterPath: 'paging/',
          limit: 10,
        })
        expect(
          stillMissing.map((g) => g.storagePath).filter((p) => p.startsWith('paging/'))
        ).toEqual(['paging/A.pdf', 'paging/a.pdf'])
        const inFiles = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'missing',
          afterPath: 'paging/',
          limit: 10,
        })
        expect(inFiles.map((g) => g.storagePath).filter((p) => p.startsWith('paging/'))).toEqual([
          'paging/A.pdf',
        ])

        // A second call finds nothing left to update and never overwrites.
        const again = await commands().setIdentityForPath({
          storageProvider: 'local',
          storagePath: 'paging/a.pdf',
          collectionId: filesId,
          fileHash: HASH_B,
          storageValidator: validator,
        })
        expect(again).toBe(0)
        const present = await queries().listStoredFilePaths({
          storageProvider: 'local',
          collectionId: filesId,
          identity: 'present',
          afterPath: 'paging/',
          limit: 1,
        })
        expect(present[0]).toEqual({
          storagePath: 'paging/a.pdf',
          hashes: [{ fileHash: HASH_A, rowCount: 2 }],
        })
      })

      describe('exact key comparison', () => {
        // Storage keys, provider names and digests are opaque bytes: a trailing
        // space, a different case or a different spelling is a different value.
        const UPPER = 'C'.repeat(64)
        const lower = 'c'.repeat(64)
        beforeAll(async () => {
          await create(FilesCollection, filesId, {
            title: { en: 'x1' },
            attachment: file('exact/a.pdf'),
          })
          await create(FilesCollection, filesId, {
            title: { en: 'x2' },
            attachment: file('exact/a.pdf '),
          })
          await create(FilesCollection, filesId, {
            title: { en: 'x3' },
            attachment: file('exact/a.pdf', { storageProvider: 'LOCAL' }),
          })
          await create(FilesCollection, filesId, {
            title: { en: 'x4' },
            attachment: file('exact/digest.pdf', { fileHash: lower }),
          })
          await create(FilesCollection, filesId, {
            title: { en: 'x5' },
            attachment: file('exact/digest.pdf', { fileHash: UPPER }),
          })
        })

        const exactMissing = async (afterPath: string, limit: number) =>
          (
            await queries().listStoredFilePaths({
              storageProvider: 'local',
              collectionId: filesId,
              identity: 'missing',
              afterPath,
              limit,
            })
          )
            .map((g) => g.storagePath)
            .filter((p) => p.startsWith('exact/'))

        it('keeps trailing-space-distinct paths apart and pages through them', async () => {
          expect(await exactMissing('exact/', 10)).toEqual(['exact/a.pdf', 'exact/a.pdf '])
          expect(await exactMissing('exact/', 1)).toEqual(['exact/a.pdf'])
          expect(await exactMissing('exact/a.pdf', 1)).toEqual(['exact/a.pdf '])
        })

        it('treats provider names as exact, case-sensitive values', async () => {
          const upper = await queries().listStoredFilePaths({
            storageProvider: 'LOCAL',
            collectionId: filesId,
            identity: 'missing',
            limit: 10,
          })
          expect(upper.map((g) => g.storagePath)).toEqual(['exact/a.pdf'])
        })

        it('updates exactly one object when paths or providers differ only by spacing or case', async () => {
          const updated = await commands().setIdentityForPath({
            storageProvider: 'local',
            storagePath: 'exact/a.pdf',
            collectionId: filesId,
            fileHash: HASH_A,
            storageValidator: { kind: 'local-stat', value: '7:7:7:3' },
          })
          expect(updated).toBe(1)
          expect(await exactMissing('exact/', 10)).toEqual(['exact/a.pdf '])
          const upper = await queries().listStoredFilePaths({
            storageProvider: 'LOCAL',
            collectionId: filesId,
            identity: 'missing',
            limit: 10,
          })
          expect(upper.map((g) => g.storagePath)).toEqual(['exact/a.pdf'])
        })

        it('groups recorded digests by exact value in verify selection', async () => {
          const page = await queries().listStoredFilePaths({
            storageProvider: 'local',
            collectionId: filesId,
            identity: 'present',
            afterPath: 'exact/b',
            limit: 1,
          })
          expect(page).toEqual([
            {
              storagePath: 'exact/digest.pdf',
              hashes: expect.arrayContaining([
                { fileHash: UPPER, rowCount: 1 },
                { fileHash: lower, rowCount: 1 },
              ]),
            },
          ])
          expect(page[0]?.hashes).toHaveLength(2)
        })
      })
    })
  })
}
