import type { CollectionDefinition, IDbAdapter, LockedDocumentRevision } from '@byline/core'
import { beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const definition: CollectionDefinition = {
  path: 'revision-conformance',
  labels: { singular: 'Revision', plural: 'Revisions' },
  fields: [{ name: 'title', type: 'text' }],
}
function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function bounded(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Revision race barrier timed out')), 10_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function documentRevisionsSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let collectionId: string
  const tools = hooks.revisionTestTools
  const observe = hooks.observeRevisionContention
  if (!tools || !observe)
    throw new Error(
      'Revision conformance requires raw fixture tools and a physical-connection barrier.'
    )
  const create = async () =>
    adapter.commands.documents
      .createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        documentData: { title: 'Original' },
        locale: 'all',
        status: 'draft',
        action: 'create',
      })
      .then(({ document }) => ({
        documentId: document.document_id as string,
        documentVersionId: document.id as string,
      }))
  const target = (documentId: string, expectedRevision = 1) => ({
    documentId,
    collectionId,
    expectedRevision,
  })
  const read = async (documentId: string, revision: number) =>
    adapter.withTransaction(
      async () => (await adapter.revisions.lock([target(documentId, revision)]))[0]!
    )

  describe('document revision primitives', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([definition])
      const collection = await adapter.commands.collections.create(definition.path, definition)
      collectionId = collection[0].id
    })
    it('validates the current schema before using the primitives', async () => {
      await adapter.revisions.assertCompatibleSchema()
    })
    it.each(['shared', 'exclusive'] as const)(
      'requires an ambient transaction for %s collection locks',
      async (mode) => {
        await expect(
          adapter.commands.collections.lockCollectionRegistration(collectionId, mode)
        ).rejects.toMatchObject({
          code: 'ERR_DATABASE',
          message: 'collection registration locks require an active transaction',
        })
        await adapter.withTransaction(async () => {
          await adapter.commands.collections.lockCollectionRegistration(collectionId, mode)
        })
        await expect(
          adapter.withTransaction(async () => {
            await adapter.commands.collections.lockCollectionRegistration(crypto.randomUUID(), mode)
          })
        ).rejects.toMatchObject({
          code: 'ERR_NOT_FOUND',
          message: 'collection registration not found',
        })
      }
    )
    it('rejects an invalid collection lock mode from an untyped caller', async () => {
      await expect(
        adapter.withTransaction(async () => {
          await adapter.commands.collections.lockCollectionRegistration(
            collectionId,
            JSON.parse('"invalid"')
          )
        })
      ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    })
    it('starts at 1 and returns locked current content and metadata', async () => {
      const doc = await create()
      const current = await read(doc.documentId, 1)
      expect(current).toMatchObject({
        documentId: doc.documentId,
        revision: 1,
        currentVersionId: doc.documentVersionId,
        status: 'draft',
        sourceLocale: 'en',
      })
      expect(await tools.readRevision(doc.documentId)).toBe(1)
    })
    it('requires a transaction and refuses forged or expired observations', async () => {
      const doc = await create()
      await expect(adapter.revisions.lock([target(doc.documentId)])).rejects.toMatchObject({
        code: 'ERR_DATABASE',
      })
      const expired = await read(doc.documentId, 1)
      await adapter.withTransaction(async () => {
        await expect(adapter.revisions.advance(expired)).rejects.toMatchObject({
          code: 'ERR_DATABASE',
        })
        const [locked] = await adapter.revisions.lock([target(doc.documentId)])
        await expect(adapter.revisions.advance({ ...locked! })).rejects.toMatchObject({
          code: 'ERR_DATABASE',
        })
      })
      expect(await tools.readRevision(doc.documentId)).toBe(1)
    })
    it('compares before no-op handling and advances at most once', async () => {
      const doc = await create()
      await read(doc.documentId, 1)
      expect(await tools.readRevision(doc.documentId)).toBe(1)
      await adapter.withTransaction(async () => {
        const [locked] = await adapter.revisions.lock([target(doc.documentId)])
        expect(await adapter.revisions.advance(locked!)).toEqual({
          documentId: doc.documentId,
          revision: 2,
        })
        await expect(adapter.revisions.advance(locked!)).rejects.toMatchObject({
          code: 'ERR_DATABASE',
        })
      })
      await expect(read(doc.documentId, 1)).rejects.toMatchObject({
        code: 'ERR_DOCUMENT_STALE',
        details: { reason: 'revision_mismatch', expectedRevision: 1, currentRevision: 2 },
      })
      expect(await tools.readRevision(doc.documentId)).toBe(2)
    })
    it('rolls back revision and metadata together', async () => {
      const doc = await create()
      await expect(
        adapter.withTransaction(async () => {
          const [locked] = await adapter.revisions.lock([target(doc.documentId)])
          await adapter.commands.documents.updateDocumentPath({
            documentId: doc.documentId,
            collectionId,
            locale: 'en',
            path: 'rolled-back',
          })
          await adapter.revisions.advance(locked!)
          throw new Error('rollback guard')
        })
      ).rejects.toThrow('rollback guard')
      expect((await read(doc.documentId, 1)).path).toBeNull()
    })
    it('preserves outer observations across rolled-back nested savepoints', async () => {
      const doc = await create()
      await adapter.withTransaction(async () => {
        const [locked] = await adapter.revisions.lock([target(doc.documentId)])
        await expect(
          adapter.withTransaction(async () => {
            await adapter.revisions.advance(locked!)
            throw new Error('inner rollback')
          })
        ).rejects.toThrow('inner rollback')
        expect(await adapter.revisions.advance(locked!)).toMatchObject({ revision: 2 })
      })
      expect(await tools.readRevision(doc.documentId)).toBe(2)
    })
    for (const rollback of [false, true]) {
      it(`expires observations issued inside a savepoint after ${rollback ? 'rollback' : 'release'}`, async () => {
        const doc = await create()
        let inner: LockedDocumentRevision | undefined
        await adapter.withTransaction(async () => {
          const nested = adapter.withTransaction(async () => {
            ;[inner] = await adapter.revisions.lock([target(doc.documentId)])
            if (rollback) throw new Error('savepoint rollback')
          })
          if (rollback) await expect(nested).rejects.toThrow('savepoint rollback')
          else await nested
          expect(inner).toBeDefined()
          await expect(adapter.revisions.advance(inner!)).rejects.toMatchObject({
            code: 'ERR_DATABASE',
          })
        })
        expect(await tools.readRevision(doc.documentId)).toBe(1)
      })
    }
    it('rejects concurrent lock acquisition within one transaction', async () => {
      const a = await create()
      const b = await create()
      await adapter.withTransaction(async () => {
        const first = adapter.revisions.lock([target(a.documentId)])
        await expect(adapter.revisions.lock([target(b.documentId)])).rejects.toThrow(
          /Concurrent document lock/
        )
        await first
      })
    })
    it('returns no mutation observations when any target in a batch is stale', async () => {
      const a = await create()
      const b = await create()
      await tools.setRevision(b.documentId, 2)
      let reachedMutation = false
      await expect(
        adapter.withTransaction(async () => {
          const locked = await adapter.revisions.lock([target(b.documentId), target(a.documentId)])
          reachedMutation = true
          for (const doc of locked) await adapter.revisions.advance(doc)
        })
      ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      expect(reachedMutation).toBe(false)
      expect(await tools.readRevision(a.documentId)).toBe(1)
      expect(await tools.readRevision(b.documentId)).toBe(2)
    })
    it('rejects missing/deleted documents and retains content parent assertions under the lock', async () => {
      await expect(read('00000000-0000-0000-0000-000000000000', 1)).rejects.toMatchObject({
        code: 'ERR_NOT_FOUND',
      })
      const doc = await create()
      await expect(
        adapter.withTransaction(() =>
          adapter.revisions.lock([
            {
              ...target(doc.documentId),
              previousVersionId: '00000000-0000-0000-0000-000000000000',
            },
          ])
        )
      ).rejects.toMatchObject({
        code: 'ERR_CONFLICT',
        details: { reason: 'stale', currentVersionId: doc.documentVersionId },
      })
      await adapter.commands.documents.softDeleteDocument({ document_id: doc.documentId })
      await expect(read(doc.documentId, 1)).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
    })
    it('reads the safe numeric boundary exactly and rejects overflow without writing', async () => {
      const doc = await create()
      await tools.setRevision(doc.documentId, Number.MAX_SAFE_INTEGER)
      await adapter.withTransaction(async () => {
        const [locked] = await adapter.revisions.lock([
          target(doc.documentId, Number.MAX_SAFE_INTEGER),
        ])
        expect(locked?.revision).toBe(Number.MAX_SAFE_INTEGER)
        await expect(adapter.revisions.advance(locked!)).rejects.toMatchObject({
          code: 'ERR_DATABASE',
        })
      })
      expect(await tools.readRevision(doc.documentId)).toBe(Number.MAX_SAFE_INTEGER)
    })
    it('sorts multi-document locks and rejects reversed acquisitions across savepoints', async () => {
      const docs = [await create(), await create()].sort((a, b) =>
        a.documentId.localeCompare(b.documentId)
      )
      await adapter.withTransaction(async () => {
        const locked = await adapter.revisions.lock(
          docs.toReversed().map((doc) => target(doc.documentId))
        )
        expect(locked.map((doc) => doc.documentId)).toEqual(docs.map((doc) => doc.documentId))
      })
      const first = docs[0],
        last = docs[1]
      if (!first || !last) throw new Error('Expected two document fixtures')
      await adapter.withTransaction(async () => {
        await adapter.revisions.lock([target(last.documentId)])
        await expect(
          adapter.withTransaction(() => adapter.revisions.lock([target(first.documentId)]))
        ).rejects.toThrow(/identity order/)
      })
    })
    for (const rollback of [false, true])
      it(`serializes two physical writers when the first ${rollback ? 'rolls back' : 'commits'}`, async () => {
        const doc = await create()
        const firstLocked = signal()
        const secondStarted = signal()
        let secondReachedMutation = false
        const observation = await observe(async (waitForTwo) => {
          const first = adapter
            .withTransaction(async () => {
              const [locked] = await adapter.revisions.lock([target(doc.documentId)])
              firstLocked.resolve()
              await bounded(secondStarted.promise)
              await bounded(waitForTwo())
              await adapter.revisions.advance(locked!)
              if (rollback) throw new Error('first rolls back')
            })
            .finally(firstLocked.resolve)
          const second = (async () => {
            await bounded(firstLocked.promise)
            return adapter.withTransaction(async () => {
              secondStarted.resolve()
              const [locked] = await adapter.revisions.lock([target(doc.documentId)])
              secondReachedMutation = true
              return adapter.revisions.advance(locked!)
            })
          })()
          return Promise.allSettled([first, second])
        })
        expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
        if (rollback) {
          expect(observation.result[0]).toMatchObject({ status: 'rejected' })
          expect(observation.result[1]).toMatchObject({
            status: 'fulfilled',
            value: { revision: 2 },
          })
        } else {
          expect(observation.result[0]).toMatchObject({ status: 'fulfilled' })
          expect(observation.result[1]).toMatchObject({
            status: 'rejected',
            reason: { code: 'ERR_DOCUMENT_STALE', details: { currentRevision: 2 } },
          })
        }
        expect(secondReachedMutation).toBe(rollback)
        expect(await tools.readRevision(doc.documentId)).toBe(2)
      })
  })
}
