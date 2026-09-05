import type { CollectionDefinition, IDbAdapter, ReadSnapshotQueries } from '@byline/core'
import { beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const definition: CollectionDefinition = {
  path: 'snapshot-conformance',
  tree: true,
  labels: { singular: 'Snapshot', plural: 'Snapshots' },
  fields: [{ name: 'title', type: 'text' }],
}

export function editableSnapshotsSuite(hooks: ConformanceHooks): void {
  let db: IDbAdapter
  let collectionId: string
  const create = async () =>
    (
      await db.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        documentData: { title: 'Before' },
        locale: 'all',
        status: 'draft',
        action: 'create',
      })
    ).document
  describe('editable snapshots', () => {
    beforeAll(async () => {
      await hooks.truncate()
      db = await hooks.createAdapter([definition])
      collectionId = (await db.commands.collections.create(definition.path, definition))[0].id
    })

    it.each(['content', 'status', 'metadata'] as const)(
      'keeps source selection and reconstruction coherent across a committed %s writer',
      async (mutation) => {
        const original = await create()
        const params = {
          collection_id: collectionId,
          document_id: original.document_id,
          locale: 'all',
          readMode: 'any' as const,
        }
        await db.commands.documents.setDocumentAvailableLocales({
          documentId: original.document_id,
          collectionId,
          availableLocales: ['en'],
        })
        await db.withReadSnapshot(async (queries) => {
          const selected = await queries.documents.getCurrentVersionMetadata(params)
          expect(selected?.document_version_id).toBe(original.id)
          // A second connection commits while the read transaction remains open.
          // Awaiting commit establishes ordering without sleeps or timing guesses.
          const writer = () =>
            db.withTransaction(async () => {
              const [locked] = await db.revisions.lock([
                { collectionId, documentId: original.document_id, expectedRevision: 1 },
              ])
              if (mutation === 'content')
                await db.commands.documents.createDocumentVersion({
                  collectionId,
                  collectionVersion: 1,
                  collectionConfig: definition,
                  documentId: original.document_id,
                  previousVersionId: original.id,
                  documentData: { title: 'After' },
                  locale: 'all',
                  status: 'draft',
                  action: 'update',
                })
              if (mutation === 'status')
                await db.commands.documents.setDocumentStatus({
                  document_version_id: original.id,
                  status: 'published',
                })
              if (mutation === 'metadata') {
                await db.commands.documents.updateDocumentPath({
                  collectionId,
                  documentId: original.document_id,
                  locale: 'en',
                  path: 'after',
                })
                await db.commands.documents.setDocumentAvailableLocales({
                  documentId: original.document_id,
                  collectionId,
                  availableLocales: ['en', 'fr'],
                })
              }
              await db.revisions.advance(locked!)
            })
          const reconstructed = await hooks.withSourceReadBarrier(writer, () =>
            queries.documents.getDocumentById({ ...params, reconstruct: true })
          )
          expect(reconstructed).toMatchObject({
            document_version_id: original.id,
            status: 'draft',
            path: '',
            fields: { title: 'Before' },
            availableLocales: ['en'],
          })
          expect(await queries.documents.getDocumentRevision(params)).toBe(1)
        })
        await db.withReadSnapshot(async (queries) => {
          expect(await queries.documents.getDocumentRevision(params)).toBe(2)
          const current = await queries.documents.getDocumentById({ ...params, reconstruct: true })
          if (mutation === 'content') expect(current.fields.title).toBe('After')
          if (mutation === 'status') expect(current.status).toBe('published')
          if (mutation === 'metadata')
            expect(current).toMatchObject({ path: 'after', availableLocales: ['en', 'fr'] })
        })
      }
    )

    it('keeps tree topology and hydrated action rows on one structural observation', async () => {
      const original = await create()
      await db.commands.documents.placeTreeNode({
        collectionId,
        documentId: original.document_id,
        parentDocumentId: null,
      })
      await db.withReadSnapshot(async (queries) => {
        const structure = await queries.documents.getTreeSubtree({ collectionId, readMode: 'any' })
        expect(structure.map((row) => row.document_id)).toEqual([original.document_id])
        await db.commands.documents.removeFromTree({
          collectionId,
          documentId: original.document_id,
        })
        expect(await queries.documents.getTreeSubtree({ collectionId, readMode: 'any' })).toEqual(
          structure
        )
        const rows = await queries.documents.getDocumentsByDocumentIds({
          collection_id: collectionId,
          document_ids: structure.map((row) => row.document_id),
          readMode: 'any',
        })
        expect(rows).toEqual([
          expect.objectContaining({
            document_id: original.document_id,
            fields: { title: 'Before' },
          }),
        ])
        expect(
          await queries.documents.getDocumentRevision({
            collection_id: collectionId,
            document_id: original.document_id,
          })
        ).toBe(1)
      })
      expect(
        await db.withReadSnapshot((queries) =>
          queries.documents.getTreeSubtree({ collectionId, readMode: 'any' })
        )
      ).toEqual([])
    })

    it('keeps schedule controls on the same observation as source metadata', async () => {
      const original = await create()
      const params = { collectionId, documentId: original.document_id }
      await db.withReadSnapshot(async (queries) => {
        await queries.documents.getCurrentVersionMetadata({
          collection_id: collectionId,
          document_id: original.document_id,
        })
        await db.withTransaction(async () => {
          await db.commands.documents.publishSchedules.schedule({
            authorizedRevision: 1,
            ...params,
            expectedVersionId: original.id,
            publishAt: new Date(Date.now() + 60_000),
            actorId: null,
          })
        })
        expect(await queries.documents.publishSchedules.get(params)).toBeNull()
        expect(
          (
            await queries.documents.publishSchedules.list({
              collectionIds: [collectionId],
              page: 1,
              pageSize: 20,
            })
          ).schedules
        ).toEqual([])
      })
      expect(
        await db.withReadSnapshot((queries) => queries.documents.publishSchedules.get(params))
      ).toMatchObject({ state: 'armed', targetVersionId: original.id })
    })

    it('observes an empty slot consistently when another connection fills it', async () => {
      const original = await create()
      await db.withReadSnapshot(async (queries) => {
        expect(await queries.singletons.getMappedDocumentId(collectionId)).toBeNull()
        await db.withTransaction(async () => {
          await db.commands.singletons.setMapping(collectionId, original.document_id)
        })
        expect(await queries.singletons.getMappedDocumentId(collectionId)).toBeNull()
      })
      expect(
        await db.withReadSnapshot((queries) => queries.singletons.getMappedDocumentId(collectionId))
      ).toBe(original.document_id)
    })

    it('excludes locking/executor surfaces for JavaScript callers and expires nested methods', async () => {
      let escaped!: ReadSnapshotQueries
      await db.withReadSnapshot(async (queries) => {
        escaped = queries
        expect('getDocumentSystemFieldsForUpdate' in queries.documents).toBe(false)
        expect(Object.keys(queries.documents).sort()).toEqual([
          'findDocuments',
          'getCanonicalDocumentOrder',
          'getCurrentPath',
          'getCurrentVersionMetadata',
          'getDocumentById',
          'getDocumentByPath',
          'getDocumentByVersion',
          'getDocumentCountsByStatus',
          'getDocumentHistory',
          'getDocumentRevision',
          'getDocumentsByDocumentIds',
          'getDocumentsByVersionIds',
          'getLastOrderKey',
          'getNeighborOrderKeys',
          'getPublishedDocumentIds',
          'getPublishedVersion',
          'getTreeAncestors',
          'getTreeChildren',
          'getTreeParent',
          'getTreeSubtree',
          'publishSchedules',
        ])
        expect('db' in queries.documents).toBe(false)
        expect('transactionDb' in queries.documents).toBe(false)
        expect(Object.keys(queries.documents.publishSchedules).sort()).toEqual(['get', 'list'])
        const assertTypeExclusion = (queries: ReadSnapshotQueries) => {
          // @ts-expect-error Locking reads are intentionally absent at type level too.
          queries.documents.getDocumentSystemFieldsForUpdate({})
        }
        void assertTypeExclusion
      })
      expect(() => escaped.singletons.getMappedDocumentId(collectionId)).toThrow(
        'Read snapshot has expired'
      )
      expect(() =>
        escaped.documents.publishSchedules.get({ collectionId, documentId: 'expired' })
      ).toThrow('Read snapshot has expired')
    })
  })
}
