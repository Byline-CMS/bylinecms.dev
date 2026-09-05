import { AdminAuth, createRequestContext, createSuperAdminContext } from '@byline/auth'
import {
  cancelDocumentScheduledPublish,
  changeDocumentStatus,
  confirmDocumentScheduledPublish,
  createDocument,
  type DocumentLifecycleContext,
  deleteDocument,
  type IDbAdapter,
  type MultiCollectionDefinition,
  placeTreeNode,
  removeFromTree,
  reorderDocument,
  scheduleDocumentPublish,
  updateDocument,
  updateDocumentSystemFields,
} from '@byline/core'
import { runScheduledPublicationSweep } from '@byline/core/scheduler'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { bounded, signal } from '../race-barrier.js'
import type { ConformanceHooks } from '../index.js'

const logger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}
export function scheduledStructuralRevisionsSuite(hooks: ConformanceHooks): void {
  let db: IDbAdapter
  let flat: DocumentLifecycleContext,
    tree: DocumentLifecycleContext,
    ordered: DocumentLifecycleContext
  const definition = (path: string, extra = {}): MultiCollectionDefinition => ({
    path,
    labels: { singular: path, plural: path },
    fields: [{ name: 'title', type: 'text' }],
    ...extra,
  })
  const create = (ctx = flat) =>
    createDocument(ctx, { data: { title: 'Original' }, path: crypto.randomUUID() })
  const revision = (ctx: DocumentLifecycleContext, documentId: string) =>
    db.queries.documents.getDocumentRevision({
      collection_id: ctx.collectionId,
      document_id: documentId,
    })
  const schedule = (
    ctx: DocumentLifecycleContext,
    doc: { documentId: string; documentVersionId: string },
    expectedRevision = 1
  ) =>
    scheduleDocumentPublish(ctx, {
      ...doc,
      expectedVersionId: doc.documentVersionId,
      expectedRevision,
      publishAt: new Date(Date.now() + 60000).toISOString(),
    })
  const sweep = (ctx: DocumentLifecycleContext) =>
    runScheduledPublicationSweep(
      {
        db,
        collections: [ctx.definition],
        collectionRecords: new Map([
          [ctx.collectionPath, { collectionId: ctx.collectionId, version: 1, schemaHash: 'test' }],
        ]),
        storage: undefined,
        logger,
        config: { slugifier: ctx.slugifier, i18n: { content: { defaultLocale: 'en' } } },
      },
      { batchSize: 1, budgetMs: 5000 }
    )
  describe('Task 7 scheduled and structural revisions', () => {
    beforeAll(async () => {
      await hooks.truncate()
      const definitions = [
        definition('task7-flat'),
        definition('task7-tree', { tree: true }),
        definition('task7-order', { orderable: true }),
      ]
      db = await hooks.createAdapter(definitions)
      const contexts: DocumentLifecycleContext[] = []
      for (const item of definitions) {
        const [row] = await db.commands.collections.create(item.path, item)
        contexts.push({
          db,
          definition: item,
          collectionId: row.id,
          collectionVersion: 1,
          collectionPath: item.path,
          defaultLocale: 'en',
          logger,
          requestContext: createSuperAdminContext({ id: '11111111-1111-4111-8111-111111111111' }),
        })
      }
      const [flatContext, treeContext, orderContext] = contexts
      if (!flatContext || !treeContext || !orderContext) throw new Error('Missing Task 7 contexts')
      flat = flatContext
      tree = treeContext
      ordered = orderContext
    })
    it('classifies a real lock timeout only after rolling back earlier writes', async () => {
      const tools = hooks.revisionTestTools
      const observe = hooks.observeRevisionContention
      if (!tools || !observe) throw new Error('Missing contention fixture tools')
      const changed = await create(),
        blocked = await create()
      const ready = signal(),
        release = signal()
      const observation = await observe(async () => {
        const holder = db.withTransaction(async () => {
          await db.commands.collections.lockCollectionRegistration(flat.collectionId, 'shared')
          await db.revisions.lock([
            {
              collectionId: flat.collectionId,
              documentId: blocked.documentId,
              expectedRevision: 1,
            },
          ])
          ready.release()
          await bounded(release.promise)
        })
        try {
          await bounded(ready.promise)
          const failing = db.withTransaction(async () => {
            await db.commands.collections.lockCollectionRegistration(flat.collectionId, 'shared')
            const [locked] = await db.revisions.lock([
              {
                collectionId: flat.collectionId,
                documentId: changed.documentId,
                expectedRevision: 1,
              },
            ])
            if (!locked) throw new Error('Missing locked fixture')
            await db.commands.documents.setOrderKey({
              document_id: changed.documentId,
              order_key: 'a9',
            })
            await db.revisions.advance(locked)
            await tools.withShortLockWait(() =>
              db.revisions.lock([
                {
                  collectionId: flat.collectionId,
                  documentId: blocked.documentId,
                  expectedRevision: 1,
                },
              ])
            )
          })
          await expect(bounded(failing)).rejects.toMatchObject({
            code: 'ERR_LOCK_CONFLICT',
            details: { rolledBack: true, retryable: true },
          })
          expect(await revision(flat, changed.documentId)).toBe(1)
          const order = await db.queries.documents.getCanonicalDocumentOrder({
            collection_id: flat.collectionId,
          })
          expect(order.find((row) => row.id === changed.documentId)?.order_key).toBeNull()
        } finally {
          release.release()
          await bounded(holder)
        }
      })
      expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
    })
    it('arms and reconfirms the resulting revision, rejects stale cancellation, and leaves cancellation no-ops unchanged', async () => {
      const doc = await create()
      const armed = await schedule(flat, doc)
      expect(armed).toMatchObject({ revision: 2, authorizedRevision: 2 })
      await expect(
        cancelDocumentScheduledPublish(flat, { documentId: doc.documentId, expectedRevision: 1 })
      ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      await updateDocumentSystemFields(flat, {
        documentId: doc.documentId,
        expectedRevision: 2,
        path: crypto.randomUUID(),
      })
      const suspended = await db.queries.documents.publishSchedules.get({
        documentId: doc.documentId,
        collectionId: flat.collectionId,
      })
      expect(suspended).toMatchObject({ state: 'needs_reconfirm', authorizedRevision: 2 })
      const confirmed = await confirmDocumentScheduledPublish(flat, {
        documentId: doc.documentId,
        expectedVersionId: doc.documentVersionId,
        expectedRevision: 3,
      })
      expect(confirmed).toMatchObject({ revision: 4, authorizedRevision: 4 })
      expect(
        await cancelDocumentScheduledPublish(flat, {
          documentId: doc.documentId,
          expectedRevision: 4,
        })
      ).toMatchObject({ revision: 5 })
      expect(
        await cancelDocumentScheduledPublish(flat, {
          documentId: doc.documentId,
          expectedRevision: 5,
        })
      ).toEqual({ schedule: null, revision: 5 })
    })
    it('creates and self-heals tree placement inside the initiating transaction with one target revision', async () => {
      const doc = await create(tree)
      expect(await revision(tree, doc.documentId)).toBe(1)
      const removed = await removeFromTree(tree, {
        documentId: doc.documentId,
        expectedRevision: 1,
      })
      expect(removed.revision).toBe(2)
      const saved = await updateDocument(tree, {
        documentId: doc.documentId,
        expectedRevision: 2,
        data: { title: 'Healed' },
      })
      expect(saved.revision).toBe(3)
      const state = await db.withTransaction(() =>
        db.revisions.readStructure({
          collectionId: tree.collectionId,
          documentIds: [doc.documentId],
        })
      )
      expect(state[0]).toMatchObject({ placed: true, revision: 3 })
    })
    it('advances promoted children and suspends their schedules without advancing unchanged roots', async () => {
      const parent = await create(tree),
        child = await create(tree),
        unchanged = await create(tree)
      await placeTreeNode(tree, {
        documentId: child.documentId,
        expectedRevision: 1,
        parentDocumentId: parent.documentId,
      })
      await schedule(tree, child, 2)
      const result = await deleteDocument(tree, {
        documentId: parent.documentId,
        expectedRevision: 1,
      })
      expect(result.revision).toBe(2)
      expect(result.scheduledPublicationsNeedReconfirmation).toBe(true)
      expect(await revision(tree, child.documentId)).toBe(4)
      expect(await revision(tree, unchanged.documentId)).toBe(1)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: child.documentId,
          collectionId: tree.collectionId,
        })
      ).toMatchObject({ state: 'needs_reconfirm', authorizedRevision: 3 })
    })
    it('does not disclose derived targets or schedule suspension to a write-only editor', async () => {
      const parent = await create(tree),
        child = await create(tree)
      await placeTreeNode(tree, {
        documentId: child.documentId,
        expectedRevision: 1,
        parentDocumentId: parent.documentId,
      })
      await schedule(tree, child, 2)
      const actor = new AdminAuth({
        id: 'task7-write-only',
        abilities: [`collections.${tree.collectionPath}.delete`],
      })
      const result = await deleteDocument(
        { ...tree, requestContext: createRequestContext({ actor, readMode: 'any' }) },
        { documentId: parent.documentId, expectedRevision: 1 }
      )
      expect(result.affectedDocuments).toEqual([{ documentId: parent.documentId, revision: 2 }])
      expect(result.scheduledPublicationsNeedReconfirmation).toBe(false)
      expect(await revision(tree, child.documentId)).toBe(4)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: child.documentId,
          collectionId: tree.collectionId,
        })
      ).toMatchObject({ state: 'needs_reconfirm' })
    })
    it('repairs flat sibling keys atomically and advances each changed document once', async () => {
      const a = await create(ordered),
        b = await create(ordered)
      await db.commands.documents.setOrderKey({ document_id: a.documentId, order_key: 'a9' })
      await db.commands.documents.setOrderKey({ document_id: b.documentId, order_key: 'a9' })
      await schedule(ordered, a)
      const result = await reorderDocument(ordered, {
        documentId: b.documentId,
        expectedRevision: 1,
        afterDocumentId: a.documentId,
      })
      expect(result.revision).toBe(2)
      expect(result.scheduledPublicationsNeedReconfirmation).toBe(true)
      const affected = result.affectedDocuments
      expect(affected).toHaveLength(2)
      expect(new Set(affected.map((item) => item.documentId)).size).toBe(affected.length)
      for (const item of affected)
        expect(item.revision).toBe(item.documentId === a.documentId ? 3 : 2)
      await expect(
        reorderDocument(ordered, { documentId: b.documentId, expectedRevision: 1 })
      ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
    })
    it('rolls back cancellation when the revision receipt cannot commit', async () => {
      const doc = await create()
      await schedule(flat, doc)
      const failure = new Error('injected revision failure')
      const spy = vi.spyOn(db.revisions, 'advance').mockRejectedValueOnce(failure)
      try {
        await expect(
          cancelDocumentScheduledPublish(flat, { documentId: doc.documentId, expectedRevision: 2 })
        ).rejects.toBe(failure)
      } finally {
        spy.mockRestore()
      }
      expect(await revision(flat, doc.documentId)).toBe(2)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: doc.documentId,
          collectionId: flat.collectionId,
        })
      ).toMatchObject({ state: 'armed', authorizedRevision: 2 })
    })
    it('rolls back all structural effects, suspension, and earlier increments on a late derived failure', async () => {
      const parent = await create(tree),
        child = await create(tree)
      await placeTreeNode(tree, {
        documentId: child.documentId,
        expectedRevision: 1,
        parentDocumentId: parent.documentId,
      })
      await schedule(tree, child, 2)
      const snapshot = () =>
        db.withTransaction(() =>
          db.revisions.readStructure({
            collectionId: tree.collectionId,
            documentIds: [parent.documentId, child.documentId],
          })
        )
      const before = await snapshot()
      const advance = db.revisions.advance.bind(db.revisions)
      const failure = new Error('injected second revision failure')
      let count = 0
      const spy = vi.spyOn(db.revisions, 'advance').mockImplementation(async (locked) => {
        if (++count === 2) throw failure
        return advance(locked)
      })
      try {
        await expect(
          deleteDocument(tree, { documentId: parent.documentId, expectedRevision: 1 })
        ).rejects.toBe(failure)
      } finally {
        spy.mockRestore()
      }
      expect(count).toBe(2)
      expect(await snapshot()).toEqual(before)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: child.documentId,
          collectionId: tree.collectionId,
        })
      ).toMatchObject({ state: 'armed', authorizedRevision: 3 })
    })
    it('rolls back initial content creation if automatic root placement fails', async () => {
      const before = await db.queries.documents.getCanonicalDocumentOrder({
        collection_id: tree.collectionId,
      })
      const append = db.commands.audit!.append.bind(db.commands.audit)
      const failure = new Error('injected initial placement failure')
      const spy = vi.spyOn(db.commands.audit!, 'append').mockImplementation(async (entry) => {
        if (entry.action === 'document.tree.placed') throw failure
        return append(entry)
      })
      try {
        await expect(create(tree)).rejects.toBe(failure)
      } finally {
        spy.mockRestore()
      }
      expect(
        await db.queries.documents.getCanonicalDocumentOrder({ collection_id: tree.collectionId })
      ).toEqual(before)
    })
    it('rejects a stale tree no-op and validates every derived target before changing anything', async () => {
      const parent = await create(tree),
        child = await create(tree)
      await placeTreeNode(tree, {
        documentId: child.documentId,
        expectedRevision: 1,
        parentDocumentId: parent.documentId,
      })
      await expect(
        placeTreeNode(tree, {
          documentId: child.documentId,
          expectedRevision: 1,
          parentDocumentId: parent.documentId,
        })
      ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      const read = db.revisions.readStructure.bind(db.revisions)
      const before = await db.withTransaction(() =>
        read({
          collectionId: tree.collectionId,
          documentIds: [parent.documentId, child.documentId],
        })
      )
      const spy = vi.spyOn(db.revisions, 'readStructure').mockImplementationOnce(async (params) => {
        const rows = await read(params)
        return rows.map((row) =>
          row.documentId === child.documentId ? { ...row, revision: row.revision + 1 } : row
        )
      })
      try {
        await expect(
          deleteDocument(tree, { documentId: parent.documentId, expectedRevision: 1 })
        ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      } finally {
        spy.mockRestore()
      }
      expect(
        await db.withTransaction(() =>
          read({
            collectionId: tree.collectionId,
            documentIds: [parent.documentId, child.documentId],
          })
        )
      ).toEqual(before)
    })
    it('rolls back content and placement together when self-heal audit fails', async () => {
      const doc = await create(tree)
      await removeFromTree(tree, { documentId: doc.documentId, expectedRevision: 1 })
      const append = db.commands.audit!.append.bind(db.commands.audit)
      const failure = new Error('injected placement audit failure')
      const spy = vi.spyOn(db.commands.audit!, 'append').mockImplementation(async (entry) => {
        if (entry.action === 'document.tree.placed') throw failure
        return append(entry)
      })
      try {
        await expect(
          updateDocument(tree, {
            documentId: doc.documentId,
            expectedRevision: 2,
            data: { title: 'Must roll back' },
          })
        ).rejects.toBe(failure)
      } finally {
        spy.mockRestore()
      }
      expect(await revision(tree, doc.documentId)).toBe(2)
      const current = await db.queries.documents.getCurrentVersionMetadata({
        collection_id: tree.collectionId,
        document_id: doc.documentId,
      })
      expect(current?.document_version_id).toBe(doc.documentVersionId)
      const rows = await db.withTransaction(() =>
        db.revisions.readStructure({
          collectionId: tree.collectionId,
          documentIds: [doc.documentId],
        })
      )
      expect(rows[0]?.placed).toBe(false)
    })
    it('suspends an authorization mismatch without adopting the new revision', async () => {
      const doc = await create()
      await schedule(flat, doc)
      await hooks.revisionTestTools!.setRevision(doc.documentId, 3)
      await hooks.revisionTestTools!.makeScheduleDue(doc.documentId)
      expect(await sweep(flat)).toMatchObject({ published: 0 })
      expect(await revision(flat, doc.documentId)).toBe(4)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: doc.documentId,
          collectionId: flat.collectionId,
        })
      ).toMatchObject({ state: 'needs_reconfirm', authorizedRevision: 2, executionToken: null })
    })
    it('leaves a replaced worker claim untouched', async () => {
      const doc = await create()
      await schedule(flat, doc)
      await hooks.revisionTestTools!.makeScheduleDue(doc.documentId)
      const ready = signal(),
        release = signal()
      const pending = sweep({
        ...flat,
        definition: {
          ...flat.definition,
          hooks: {
            beforeStatusChange: async () => {
              ready.release()
              await bounded(release.promise)
            },
          },
        },
      })
      let replacementToken: string | undefined
      try {
        await bounded(ready.promise)
        const current = await db.queries.documents.publishSchedules.get({
          documentId: doc.documentId,
          collectionId: flat.collectionId,
        })
        if (!current?.executionToken) throw new Error('Missing worker claim')
        await db.commands.documents.publishSchedules.releaseClaim({
          documentId: doc.documentId,
          executionToken: current.executionToken,
          error: 'test ownership loss',
        })
        await hooks.revisionTestTools!.makeScheduleDue(doc.documentId)
        const [replacement] = await db.commands.documents.publishSchedules.claimDue({
          batchSize: 1,
          leaseMs: 60000,
        })
        if (!replacement) throw new Error('Missing replacement claim')
        replacementToken = replacement.executionToken
      } finally {
        release.release()
        await bounded(pending)
      }
      expect(await bounded(pending)).toMatchObject({ published: 0 })
      expect(await revision(flat, doc.documentId)).toBe(2)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: doc.documentId,
          collectionId: flat.collectionId,
        })
      ).toMatchObject({ state: 'armed', authorizedRevision: 2, executionToken: replacementToken })
      await cancelDocumentScheduledPublish(flat, {
        documentId: doc.documentId,
        expectedRevision: 2,
      })
    })
    it.each(['save', 'status', 'delete'] as const)(
      'never publishes over an editor %s during worker preparation',
      async (operation) => {
        const doc = await create()
        await schedule(flat, doc)
        if (!hooks.revisionTestTools) throw new Error('Missing revision fixture tools')
        await hooks.revisionTestTools.makeScheduleDue(doc.documentId)
        const ready = signal(),
          release = signal()
        const pending = sweep({
          ...flat,
          definition: {
            ...flat.definition,
            hooks: {
              beforeStatusChange: async () => {
                ready.release()
                await bounded(release.promise)
              },
            },
          },
        })
        void pending.catch(() => {})
        try {
          await bounded(ready.promise)
          if (operation === 'save')
            await updateDocument(flat, {
              documentId: doc.documentId,
              expectedRevision: 2,
              data: { title: 'Editor' },
            })
          else if (operation === 'status')
            await changeDocumentStatus(flat, {
              documentId: doc.documentId,
              expectedRevision: 2,
              nextStatus: 'published',
            })
          else await deleteDocument(flat, { documentId: doc.documentId, expectedRevision: 2 })
        } finally {
          release.release()
          await bounded(pending)
        }
        const outcome = await bounded(pending)
        expect(outcome.published).toBe(0)
        expect(await revision(flat, doc.documentId)).toBe(3)
      }
    )
    it.each(['save', 'status', 'delete'] as const)(
      'publishes atomically before a competing editor %s that reaches its final lock later',
      async (operation) => {
        const observe = hooks.observeRevisionContention
        if (!observe) throw new Error('Missing connection observer')
        const doc = await create()
        await schedule(flat, doc)
        await hooks.revisionTestTools!.makeScheduleDue(doc.documentId)
        const ready = signal(),
          release = signal()
        const lockClaim = db.commands.documents.publishSchedules.lockClaim.bind(
          db.commands.documents.publishSchedules
        )
        const spy = vi
          .spyOn(db.commands.documents.publishSchedules, 'lockClaim')
          .mockImplementationOnce(async (params) => {
            const claim = await lockClaim(params)
            if (!claim) throw new Error('Worker lost claim before test barrier')
            ready.release()
            await bounded(release.promise)
            return claim
          })
        try {
          const observation = await observe(async (waitForTwoConnections) => {
            const worker = sweep(flat)
            let editor: Promise<unknown> | undefined
            try {
              await bounded(ready.promise)
              editor =
                operation === 'save'
                  ? updateDocument(flat, {
                      documentId: doc.documentId,
                      expectedRevision: 2,
                      data: { title: 'Editor' },
                    })
                  : operation === 'status'
                    ? changeDocumentStatus(flat, {
                        documentId: doc.documentId,
                        expectedRevision: 2,
                        nextStatus: 'published',
                      })
                    : deleteDocument(flat, { documentId: doc.documentId, expectedRevision: 2 })
              void editor.catch(() => {})
              await bounded(waitForTwoConnections())
            } finally {
              release.release()
              const [workerResult, editorResult] = await bounded(
                Promise.allSettled([worker, editor])
              )
              expect(workerResult).toMatchObject({ status: 'fulfilled', value: { published: 1 } })
              expect(editorResult).toMatchObject({
                status: 'rejected',
                reason: { code: 'ERR_DOCUMENT_STALE' },
              })
            }
          })
          expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
        } finally {
          release.release()
          spy.mockRestore()
        }
        expect(await revision(flat, doc.documentId)).toBe(3)
      }
    )
    it('serializes opposite-direction tree moves with a coordinated lock winner', async () => {
      const observe = hooks.observeRevisionContention
      if (!observe) throw new Error('Missing connection observer')
      const a = await create(tree),
        b = await create(tree)
      const ready = signal(),
        release = signal()
      const lock = db.revisions.lock.bind(db.revisions)
      const spy = vi.spyOn(db.revisions, 'lock').mockImplementationOnce(async (targets) => {
        const result = await lock(targets)
        ready.release()
        await bounded(release.promise)
        return result
      })
      try {
        const observation = await observe(async (waitForTwoConnections) => {
          const first = placeTreeNode(tree, {
            documentId: a.documentId,
            expectedRevision: 1,
            parentDocumentId: b.documentId,
          })
          let second: Promise<unknown> | undefined
          try {
            await bounded(ready.promise)
            second = placeTreeNode(tree, {
              documentId: b.documentId,
              expectedRevision: 1,
              parentDocumentId: a.documentId,
            })
            void second.catch(() => {})
            await bounded(waitForTwoConnections())
          } finally {
            release.release()
            const [winner, loser] = await bounded(Promise.allSettled([first, second]))
            expect(winner.status).toBe('fulfilled')
            expect(loser).toMatchObject({
              status: 'rejected',
              reason: {
                code: 'ERR_VALIDATION',
                message: 'move would create a cycle in the document tree',
              },
            })
          }
        })
        expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
      } finally {
        release.release()
        spy.mockRestore()
      }
      expect(await revision(tree, a.documentId)).toBe(2)
      expect(await revision(tree, b.documentId)).toBe(1)
    })
    it('publishes only the authorized revision and advances it once while clearing the claim', async () => {
      const doc = await create()
      await schedule(flat, doc)
      await hooks.revisionTestTools!.makeScheduleDue(doc.documentId)
      expect(await sweep(flat)).toMatchObject({ published: 1, failed: 0 })
      expect(await revision(flat, doc.documentId)).toBe(3)
      expect(
        await db.queries.documents.publishSchedules.get({
          documentId: doc.documentId,
          collectionId: flat.collectionId,
        })
      ).toBeNull()
    })
  })
}
