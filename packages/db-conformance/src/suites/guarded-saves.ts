/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth, createRequestContext, createSuperAdminContext } from '@byline/auth'
import type {
  BylineLogger,
  DocumentLifecycleContext,
  IDbAdapter,
  MultiCollectionDefinition,
} from '@byline/core'
import {
  changeDocumentStatus,
  copyToLocale,
  createDocument,
  deleteDocument,
  deleteLocale,
  duplicateDocument,
  replaceDocumentFieldsPreservingStatus,
  restoreDocumentVersion,
  saveDocument,
  unpublishDocument,
  updateDocument,
  updateDocumentSystemFields,
} from '@byline/core/services'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const definition: MultiCollectionDefinition = {
  path: 'guarded-save-conformance',
  labels: { singular: 'Guarded save', plural: 'Guarded saves' },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'translation', type: 'text', localized: true, optional: true },
    { name: 'attachment', type: 'text', optional: true },
  ],
}
const logger: BylineLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}
function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Guarded save barrier timed out')), 10000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
export function guardedSavesSuite(hooks: ConformanceHooks): void {
  let db: IDbAdapter
  let ctx: DocumentLifecycleContext
  const create = () =>
    createDocument(ctx, { data: { title: 'Original' }, path: crypto.randomUUID(), locale: 'en' })
  const state = async (documentId: string) => ({
    document: await db.queries.documents.getDocumentById({
      collection_id: ctx.collectionId,
      document_id: documentId,
      locale: 'all',
      readMode: 'any',
      reconstruct: true,
    }),
    revision: await db.queries.documents.getDocumentRevision({
      collection_id: ctx.collectionId,
      document_id: documentId,
    }),
    audit: await db.queries.audit.getDocumentAuditLog({ document_id: documentId }),
    schedule: await db.queries.documents.publishSchedules.get({
      documentId,
      collectionId: ctx.collectionId,
    }),
  })
  const arm = (doc: { documentId: string; documentVersionId: string }) =>
    db.withTransaction(() =>
      db.commands.documents.publishSchedules.schedule({
        authorizedRevision: 1,
        documentId: doc.documentId,
        collectionId: ctx.collectionId,
        expectedVersionId: doc.documentVersionId,
        publishAt: new Date(Date.now() + 3600000),
        actorId: null,
      })
    )
  const combined = (documentId: string) =>
    saveDocument(ctx, {
      documentId,
      expectedRevision: 1,
      locale: 'en',
      path: crypto.randomUUID(),
      availableLocales: ['en', 'fr'],
      patches: [{ kind: 'field.set', path: 'title', value: 'Edited' }],
    })
  describe('guarded lifecycle saves', () => {
    beforeAll(async () => {
      await hooks.truncate()
      db = await hooks.createAdapter([definition])
      const collectionId = (await db.commands.collections.create(definition.path, definition))[0].id
      ctx = {
        db,
        definition,
        collectionId,
        collectionVersion: 1,
        collectionPath: definition.path,
        defaultLocale: 'en',
        logger,
        requestContext: createSuperAdminContext({ id: 'guarded-save-conformance' }),
      }
    })
    describe('Task 6 remaining lifecycle guards', () => {
      type Operation = (
        context: DocumentLifecycleContext,
        doc: { documentId: string; documentVersionId: string },
        expectedRevision: number
      ) => Promise<{ documentId: string; revision: number }>
      const operations: { name: string; run: Operation; changesSource: boolean }[] = [
        {
          name: 'status',
          run: (context, doc, expectedRevision) =>
            changeDocumentStatus(context, {
              documentId: doc.documentId,
              expectedRevision,
              nextStatus: 'published',
            }),
          changesSource: true,
        },
        {
          name: 'unpublish',
          run: (context, doc, expectedRevision) =>
            unpublishDocument(context, { documentId: doc.documentId, expectedRevision }),
          changesSource: true,
        },
        {
          name: 'delete',
          run: (context, doc, expectedRevision) =>
            deleteDocument(context, { documentId: doc.documentId, expectedRevision }),
          changesSource: true,
        },
        {
          name: 'delete locale',
          run: (context, doc, expectedRevision) =>
            deleteLocale(context, { documentId: doc.documentId, expectedRevision, locale: 'fr' }),
          changesSource: true,
        },
        {
          name: 'restore',
          run: (context, doc, expectedRevision) =>
            restoreDocumentVersion(context, {
              documentId: doc.documentId,
              expectedRevision,
              sourceVersionId: doc.documentVersionId,
            }),
          changesSource: true,
        },
        {
          name: 'copy locale',
          run: (context, doc, expectedRevision) =>
            copyToLocale(context, {
              documentId: doc.documentId,
              expectedRevision,
              sourceLocale: 'en',
              targetLocale: 'fr',
              overwrite: true,
            }),
          changesSource: true,
        },
        {
          name: 'duplicate',
          run: (context, doc, expectedRevision) =>
            duplicateDocument(context, { sourceDocumentId: doc.documentId, expectedRevision }),
          changesSource: false,
        },
      ]
      // Published immutable history plus current localized draft, revision 2.
      const fixture = async () => {
        const doc = await createDocument(ctx, {
          data: { title: 'Original', translation: 'English' },
          locale: 'en',
          status: 'published',
          path: crypto.randomUUID(),
        })
        await updateDocument(ctx, {
          documentId: doc.documentId,
          expectedRevision: doc.revision,
          locale: 'fr',
          data: { title: 'French', translation: 'French' },
        })
        return doc
      }
      it.each(operations)(
        '$name rejects stale and missing observations without hooks or writes',
        async ({ run }) => {
          const doc = await fixture(),
            before = await state(doc.documentId)
          const hook = vi.fn()
          const guarded = {
            ...ctx,
            definition: {
              ...definition,
              hooks: {
                beforeUpdate: hook,
                afterUpdate: hook,
                beforeStatusChange: hook,
                afterStatusChange: hook,
                beforeUnpublish: hook,
                afterUnpublish: hook,
                beforeDelete: hook,
                afterDelete: hook,
                beforeCreate: hook,
                afterCreate: hook,
              },
            },
          }
          await expect(run(guarded, doc, 1)).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
          // JSON omission models an untyped caller, without casting an adapter or bypassing storage.
          const missing = JSON.parse('{}')
          await expect(run(guarded, doc, missing.expectedRevision)).rejects.toMatchObject({
            code: 'ERR_VALIDATION',
            details: { reason: 'missing_document_revision' },
          })
          expect(hook).not.toHaveBeenCalled()
          expect(await state(doc.documentId)).toEqual(before)
        }
      )
      it.each(operations)(
        '$name commits with exactly the appropriate revision advance',
        async ({ run, changesSource }) => {
          const doc = await fixture()
          const result = await run(ctx, doc, 2)
          expect(result.revision).toBe(changesSource ? 3 : 1)
          expect((await state(doc.documentId)).revision).toBe(changesSource ? 3 : 2)
        }
      )
      it.each(operations.filter((op) => op.changesSource))(
        '$name rolls back version, status, schedule, audit and revision on final failure',
        async ({ run }) => {
          const doc = await fixture()
          const current = (await state(doc.documentId)).document!
          await arm({ documentId: doc.documentId, documentVersionId: current.document_version_id })
          const before = await state(doc.documentId)
          const fail = vi
            .spyOn(db.revisions, 'advance')
            .mockRejectedValueOnce(new Error('final revision failure'))
          try {
            await expect(run(ctx, doc, 2)).rejects.toThrow('final revision failure')
            expect(await state(doc.documentId)).toEqual(before)
          } finally {
            fail.mockRestore()
          }
        }
      )
      it('validates stale no-ops and retains the revision for current status/unpublish no-ops', async () => {
        const doc = await create()
        expect(
          (
            await changeDocumentStatus(ctx, {
              documentId: doc.documentId,
              expectedRevision: 1,
              nextStatus: 'draft',
            })
          ).revision
        ).toBe(1)
        expect(
          (await unpublishDocument(ctx, { documentId: doc.documentId, expectedRevision: 1 }))
            .revision
        ).toBe(1)
        await updateDocumentSystemFields(ctx, {
          documentId: doc.documentId,
          expectedRevision: 1,
          path: crypto.randomUUID(),
        })
        await expect(
          changeDocumentStatus(ctx, {
            documentId: doc.documentId,
            expectedRevision: 1,
            nextStatus: 'draft',
          })
        ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
        await expect(
          unpublishDocument(ctx, { documentId: doc.documentId, expectedRevision: 1 })
        ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      })
      it('rejects a duplicate after source preparation if another editor wins', async () => {
        const doc = await create(),
          ready = barrier(),
          release = barrier(),
          afterCreate = vi.fn()
        const pending = duplicateDocument(
          {
            ...ctx,
            definition: {
              ...definition,
              hooks: {
                beforeCreate: async () => {
                  ready.release()
                  await bounded(release.promise)
                },
                afterCreate,
              },
            },
          },
          { sourceDocumentId: doc.documentId, expectedRevision: 1 }
        )
        const rejected = expect(pending).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
        await bounded(ready.promise)
        await updateDocumentSystemFields(ctx, {
          documentId: doc.documentId,
          expectedRevision: 1,
          path: crypto.randomUUID(),
        })
        const insert = vi.spyOn(db.commands.documents, 'createDocumentVersion')
        try {
          release.release()
          await rejected
          expect(insert).not.toHaveBeenCalled()
          expect(afterCreate).not.toHaveBeenCalled()
        } finally {
          insert.mockRestore()
        }
      })
      it('rolls back a duplicate destination and leaves its guarded source unchanged on storage failure', async () => {
        const doc = await create(),
          before = await state(doc.documentId)
        let destination: string | undefined
        const insert = db.commands.documents.createDocumentVersion.bind(db.commands.documents)
        const failure = vi
          .spyOn(db.commands.documents, 'createDocumentVersion')
          .mockImplementationOnce(async (params) => {
            const result = await insert(params)
            destination = result.document.document_id
            throw new Error('duplicate rollback')
          })
        try {
          await expect(
            duplicateDocument(ctx, { sourceDocumentId: doc.documentId, expectedRevision: 1 })
          ).rejects.toThrow('duplicate rollback')
          expect(await state(doc.documentId)).toEqual(before)
          if (!destination)
            throw new Error('Expected destination insertion before injected failure')
          expect((await state(destination)).document).toBeNull()
        } finally {
          failure.mockRestore()
        }
      })
      it.each(['afterStatusChange', 'afterUnpublish'] as const)(
        'returns a committed receipt when %s fails outside the lock interval',
        async (phase) => {
          const doc = await fixture()
          const hook = vi.fn(() => {
            expect(db.revisions.isInTransaction()).toBe(false)
            throw new Error('after commit')
          })
          const scoped = { ...ctx, definition: { ...definition, hooks: { [phase]: hook } } }
          const write =
            phase === 'afterStatusChange'
              ? changeDocumentStatus(scoped, {
                  documentId: doc.documentId,
                  expectedRevision: 2,
                  nextStatus: 'published',
                })
              : unpublishDocument(scoped, { documentId: doc.documentId, expectedRevision: 2 })
          await expect(write).rejects.toMatchObject({
            code: 'ERR_DOCUMENT_HOOK_COMMITTED',
            details: { phase, documentId: doc.documentId, revision: 3 },
          })
          expect((await state(doc.documentId)).revision).toBe(3)
          expect(hook).toHaveBeenCalledOnce()
        }
      )
      it.each([
        ...operations,
        {
          name: 'replacement',
          run: (
            context: DocumentLifecycleContext,
            doc: { documentId: string },
            expectedRevision: number
          ) =>
            updateDocument(context, {
              documentId: doc.documentId,
              expectedRevision,
              data: { title: 'Replaced' },
            }),
        },
        {
          name: 'metadata',
          run: (
            context: DocumentLifecycleContext,
            doc: { documentId: string },
            expectedRevision: number
          ) =>
            updateDocumentSystemFields(context, {
              documentId: doc.documentId,
              expectedRevision,
              path: crypto.randomUUID(),
            }),
        },
      ])(
        '$name locks the collection before the document in a flat collection',
        async ({ name, run }) => {
          const doc = await fixture(),
            order: string[] = []
          const slot = db.commands.collections.lockCollectionRegistration.bind(
            db.commands.collections
          )
          const lock = db.revisions.lock.bind(db.revisions)
          const slotSpy = vi
            .spyOn(db.commands.collections, 'lockCollectionRegistration')
            .mockImplementation(async (id, mode) => {
              order.push(`collection:${mode}`)
              return slot(id, mode)
            })
          const lockSpy = vi.spyOn(db.revisions, 'lock').mockImplementation(async (targets) => {
            order.push('document')
            return lock(targets)
          })
          try {
            await run(ctx, doc, 2)
            expect(order).toEqual([
              `collection:${name === 'delete' ? 'exclusive' : 'shared'}`,
              'document',
              // Duplicate creates a new row under the already-held shared lock.
              ...(name === 'duplicate' ? ['collection:shared'] : []),
            ])
          } finally {
            slotSpy.mockRestore()
            lockSpy.mockRestore()
          }
        }
      )
      it('commits a different document while the first save holds its collection and document locks', async () => {
        const firstDoc = await create(),
          secondDoc = await create()
        const ready = barrier(),
          release = barrier()
        const lock = db.revisions.lock.bind(db.revisions)
        const spy = vi.spyOn(db.revisions, 'lock').mockImplementation(async (targets) => {
          const locked = await lock(targets)
          if (targets.some((target) => target.documentId === firstDoc.documentId)) {
            ready.release()
            await bounded(release.promise)
          }
          return locked
        })
        let firstSettled = false
        const first = updateDocument(ctx, {
          documentId: firstDoc.documentId,
          expectedRevision: 1,
          data: { title: 'First' },
        })
        void first.then(
          () => {
            firstSettled = true
          },
          () => {
            firstSettled = true
          }
        )
        let second: ReturnType<typeof updateDocument> | undefined
        try {
          await bounded(ready.promise)
          second = updateDocument(ctx, {
            documentId: secondDoc.documentId,
            expectedRevision: 1,
            data: { title: 'Second' },
          })
          expect(await bounded(second)).toMatchObject({ revision: 2 })
          expect(firstSettled).toBe(false)
        } finally {
          release.release()
          await Promise.allSettled([first, ...(second ? [second] : [])])
          spy.mockRestore()
        }
        expect(await first).toMatchObject({ revision: 2 })
      })
      it('serializes a content save against deletion without a foreign-key lock inversion', async () => {
        const doc = await create()
        const outcomes = await Promise.allSettled([
          updateDocument(ctx, {
            documentId: doc.documentId,
            expectedRevision: 1,
            data: { title: 'Concurrent replacement' },
          }),
          deleteDocument(ctx, { documentId: doc.documentId, expectedRevision: 1 }),
        ])
        expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        const rejected = outcomes.find((result) => result.status === 'rejected')
        if (rejected?.status !== 'rejected')
          throw new Error('Expected one rejected stale/unavailable operation')
        expect(['ERR_DOCUMENT_STALE', 'ERR_NOT_FOUND']).toContain(rejected.reason.code)
      })
      it('rechecks after status preparation and never publishes a newer winner', async () => {
        const doc = await create(),
          ready = barrier(),
          release = barrier()
        const afterStatusChange = vi.fn()
        const pending = changeDocumentStatus(
          {
            ...ctx,
            definition: {
              ...definition,
              hooks: {
                beforeStatusChange: async () => {
                  ready.release()
                  await bounded(release.promise)
                },
                afterStatusChange,
              },
            },
          },
          { documentId: doc.documentId, expectedRevision: 1, nextStatus: 'published' }
        )
        const rejected = expect(pending).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
        await bounded(ready.promise)
        await updateDocument(ctx, {
          documentId: doc.documentId,
          expectedRevision: 1,
          data: { title: 'Winner' },
        })
        release.release()
        await rejected
        expect((await state(doc.documentId)).document).toMatchObject({
          status: 'draft',
          fields: { title: 'Winner' },
        })
        expect(afterStatusChange).not.toHaveBeenCalled()
      })
    })
    describe('Task 6 / T5-1 media maintenance', () => {
      it.each(['draft', 'published', 'archived', 'reviewed'])(
        'preserves observed %s status with one advance and no status-change audit',
        async (status) => {
          const scoped = {
            ...ctx,
            definition: {
              ...definition,
              workflow: {
                statuses: ['draft', 'published', 'archived', 'reviewed'].map((name) => ({
                  name,
                  label: name,
                  verb: name,
                })),
              },
            },
          }
          const doc = await createDocument(scoped, {
            data: { title: 'Before maintenance' },
            status,
            path: crypto.randomUUID(),
          })
          const afterUpdate = vi.fn(() => {
            expect(db.revisions.isInTransaction()).toBe(false)
          })
          const result = await replaceDocumentFieldsPreservingStatus(
            { ...scoped, definition: { ...scoped.definition, hooks: { afterUpdate } } },
            { documentId: doc.documentId, expectedRevision: 1, data: { title: 'Regenerated' } }
          )
          expect(result.revision).toBe(2)
          expect((await state(doc.documentId)).document).toMatchObject({
            status,
            fields: { title: 'Regenerated' },
          })
          const history = await db.queries.documents.getDocumentByVersion({
            document_version_id: doc.documentVersionId,
            locale: 'all',
          })
          expect(history?.status).toBe(status === 'published' ? 'archived' : status)
          const published = await db.queries.documents.getPublishedVersion({
            collection_id: ctx.collectionId,
            document_id: doc.documentId,
          })
          if (status === 'published')
            expect(published?.document_version_id).toBe(result.documentVersionId)
          expect(JSON.stringify((await state(doc.documentId)).audit)).not.toContain(
            'document.status.changed'
          )
          expect(afterUpdate).toHaveBeenCalledOnce()
        }
      )
      it('takes an exclusive collection lock before the maintenance document lock', async () => {
        const doc = await create()
        const order: string[] = []
        const collection = db.commands.collections.lockCollectionRegistration.bind(
          db.commands.collections
        )
        const document = db.revisions.lock.bind(db.revisions)
        const collectionSpy = vi
          .spyOn(db.commands.collections, 'lockCollectionRegistration')
          .mockImplementation(async (id, mode) => {
            order.push(mode)
            return collection(id, mode)
          })
        const documentSpy = vi.spyOn(db.revisions, 'lock').mockImplementation(async (targets) => {
          order.push('document')
          return document(targets)
        })
        try {
          await replaceDocumentFieldsPreservingStatus(ctx, {
            documentId: doc.documentId,
            expectedRevision: 1,
            data: { title: 'Maintained' },
          })
          expect(order).toEqual(['exclusive', 'document'])
        } finally {
          collectionSpy.mockRestore()
          documentSpy.mockRestore()
        }
      })
      it('rejects an observed status no longer declared by the collection', async () => {
        const doc = await createDocument(ctx, {
          data: { title: 'Before' },
          status: 'published',
          path: crypto.randomUUID(),
        })
        const beforeUpdate = vi.fn()
        const scoped = {
          ...ctx,
          definition: {
            ...definition,
            workflow: { statuses: [{ name: 'draft', label: 'Draft', verb: 'Save' }] },
            hooks: { beforeUpdate },
          },
        }
        await expect(
          replaceDocumentFieldsPreservingStatus(scoped, {
            documentId: doc.documentId,
            expectedRevision: 1,
            data: { title: 'Rejected' },
          })
        ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
        expect(beforeUpdate).not.toHaveBeenCalled()
        expect((await state(doc.documentId)).revision).toBe(1)
      })
      it('rejects an external transaction and stale processing output', async () => {
        const doc = await create()
        const write = () =>
          replaceDocumentFieldsPreservingStatus(ctx, {
            documentId: doc.documentId,
            expectedRevision: 1,
            data: { title: 'Processed' },
          })
        await expect(db.withTransaction(write)).rejects.toMatchObject({
          code: 'ERR_VALIDATION',
          details: { reason: 'external_lifecycle_transaction' },
        })
        await updateDocument(ctx, {
          documentId: doc.documentId,
          expectedRevision: 1,
          data: { title: 'Winner' },
        })
        await expect(write()).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
        expect((await state(doc.documentId)).document?.fields.title).toBe('Winner')
      })
      it.each(['maintenance', 'update', 'publish'])(
        'requires the %s permission before maintenance writes',
        async (missing) => {
          const doc = await createDocument(ctx, {
            data: { title: 'Before' },
            status: 'published',
            path: crypto.randomUUID(),
          })
          const abilities = {
            maintenance: 'system.documentMaintenance',
            update: `collections.${definition.path}.update`,
            publish: `collections.${definition.path}.publish`,
          }
          const requestContext = createRequestContext({
            actor: new AdminAuth({
              id: 'limited',
              abilities: Object.entries(abilities)
                .filter(([key]) => key !== missing)
                .map(([, value]) => value),
            }),
          })
          await expect(
            replaceDocumentFieldsPreservingStatus(
              { ...ctx, requestContext },
              { documentId: doc.documentId, expectedRevision: 1, data: { title: 'Rejected' } }
            )
          ).rejects.toMatchObject({ code: 'ERR_FORBIDDEN' })
          expect((await state(doc.documentId)).revision).toBe(1)
        }
      )
      it('reports a committed maintenance receipt when its afterUpdate hook fails', async () => {
        const doc = await createDocument(ctx, {
          data: { title: 'Before' },
          status: 'published',
          path: crypto.randomUUID(),
        })
        const afterUpdate = vi.fn(() => {
          expect(db.revisions.isInTransaction()).toBe(false)
          throw new Error('maintenance after commit')
        })
        await expect(
          replaceDocumentFieldsPreservingStatus(
            { ...ctx, definition: { ...definition, hooks: { afterUpdate } } },
            {
              documentId: doc.documentId,
              expectedRevision: 1,
              data: { title: 'Committed maintenance' },
            }
          )
        ).rejects.toMatchObject({
          code: 'ERR_DOCUMENT_HOOK_COMMITTED',
          details: { phase: 'afterUpdate', documentId: doc.documentId, revision: 2 },
        })
        expect((await state(doc.documentId)).document).toMatchObject({
          status: 'published',
          fields: { title: 'Committed maintenance' },
        })
        expect((await state(doc.documentId)).revision).toBe(2)
      })
      it.each(['archive', 'audit', 'revision'])(
        'rolls back content, publication, schedule and revision when %s fails',
        async (stage) => {
          const doc = await createDocument(ctx, {
            data: { title: 'Before' },
            status: 'published',
            path: crypto.randomUUID(),
          })
          // Raw schedule fixture deliberately arms published content to exercise atomic suspension.
          await arm(doc)
          const before = await state(doc.documentId)
          const spy =
            stage === 'archive'
              ? vi.spyOn(db.commands.documents, 'archivePublishedVersions')
              : stage === 'audit'
                ? vi.spyOn(db.commands.audit, 'append')
                : vi.spyOn(db.revisions, 'advance')
          spy.mockRejectedValueOnce(new Error('maintenance rollback'))
          try {
            await expect(
              replaceDocumentFieldsPreservingStatus(ctx, {
                documentId: doc.documentId,
                expectedRevision: 1,
                data: { title: 'Rejected' },
              })
            ).rejects.toThrow('maintenance rollback')
            expect(await state(doc.documentId)).toEqual(before)
          } finally {
            spy.mockRestore()
          }
        }
      )
    })
    it('returns creation revision 1 and advances a combined save exactly once', async () => {
      const doc = await create()
      expect(doc.revision).toBe(1)
      await arm(doc)
      const result = await combined(doc.documentId)
      expect(result.revision).toBe(2)
      const after = await state(doc.documentId)
      expect(after.revision).toBe(2)
      expect(after.document?.fields.title).toBe('Edited')
      expect(after.document?.availableLocales).toEqual(['en', 'fr'])
      expect(after.schedule).toMatchObject({
        state: 'needs_reconfirm',
        suspendedReason: 'content_edited',
      })
    })
    it('detects a live path collision before inserting content', async () => {
      const occupied = await create(),
        doc = await create()
      const path = (await state(occupied.documentId)).document?.path
      const before = await state(doc.documentId)
      const insert = vi.spyOn(db.commands.documents, 'createDocumentVersion')
      try {
        await expect(
          saveDocument(ctx, {
            documentId: doc.documentId,
            expectedRevision: 1,
            path,
            patches: [{ kind: 'field.set', path: 'title', value: 'Rejected' }],
          })
        ).rejects.toMatchObject({ code: 'ERR_PATH_CONFLICT' })
        expect(insert).not.toHaveBeenCalled()
        expect(await state(doc.documentId)).toEqual(before)
      } finally {
        insert.mockRestore()
      }
    })
    it('classifies metadata after-hook failure with the committed revision', async () => {
      const doc = await create()
      await expect(
        updateDocumentSystemFields(
          {
            ...ctx,
            definition: {
              ...definition,
              hooks: {
                afterSystemFieldsChange: () => {
                  throw new Error('cache failed')
                },
              },
            },
          },
          { documentId: doc.documentId, expectedRevision: 1, availableLocales: ['en'] }
        )
      ).rejects.toMatchObject({
        code: 'ERR_DOCUMENT_HOOK_COMMITTED',
        details: { phase: 'afterSystemFieldsChange', revision: 2 },
      })
      expect((await state(doc.documentId)).revision).toBe(2)
    })
    it.each(['path', 'content', 'audit', 'schedule', 'revision'] as const)(
      'rolls back all document state when %s fails',
      async (stage) => {
        const doc = await create()
        await arm(doc)
        const before = await state(doc.documentId)
        const afterHook = vi.fn()
        ctx.definition = {
          ...definition,
          hooks: { afterUpdate: afterHook, afterSystemFieldsChange: afterHook },
        }
        const boom = new Error(`Injected ${stage} failure`)
        const spy =
          stage === 'path'
            ? vi.spyOn(db.commands.documents, 'updateDocumentPath')
            : stage === 'content'
              ? vi.spyOn(db.commands.documents, 'createDocumentVersion')
              : stage === 'audit'
                ? vi.spyOn(db.commands.audit, 'append')
                : stage === 'schedule'
                  ? vi.spyOn(db.commands.documents.publishSchedules, 'suspendForContentEdit')
                  : vi.spyOn(db.revisions, 'advance')
        spy.mockRejectedValueOnce(boom)
        try {
          await expect(combined(doc.documentId)).rejects.toThrow(boom.message)
          expect(await state(doc.documentId)).toEqual(before)
          expect(afterHook).not.toHaveBeenCalled()
        } finally {
          spy.mockRestore()
          ctx.definition = definition
        }
      }
    )
    it('checks stale metadata no-ops and suspends schedules for changed metadata', async () => {
      const doc = await create()
      await arm(doc)
      expect(
        (await updateDocumentSystemFields(ctx, { documentId: doc.documentId, expectedRevision: 1 }))
          .revision
      ).toBe(1)
      expect(
        (
          await updateDocumentSystemFields(ctx, {
            documentId: doc.documentId,
            expectedRevision: 1,
            availableLocales: ['en'],
          })
        ).revision
      ).toBe(2)
      const after = await state(doc.documentId)
      expect(after.schedule).toMatchObject({
        state: 'needs_reconfirm',
        suspendedReason: 'document_metadata_changed',
      })
      await expect(
        updateDocumentSystemFields(ctx, {
          documentId: doc.documentId,
          expectedRevision: 1,
          availableLocales: ['en'],
        })
      ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      expect(await state(doc.documentId)).toEqual(after)
    })
    it('rejects a losing prepared replacement without replaying hooks or attaching its upload', async () => {
      const doc = await create()
      const entered = barrier(),
        release = barrier()
      const beforeUpdate = vi.fn(async () => {
        entered.release()
        await bounded(release.promise)
      })
      const afterUpdate = vi.fn()
      const loser = updateDocument(
        { ...ctx, definition: { ...definition, hooks: { beforeUpdate, afterUpdate } } },
        {
          documentId: doc.documentId,
          expectedRevision: 1,
          data: { title: 'Losing draft', attachment: 'prepared-object-key' },
        }
      ).then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      try {
        await bounded(entered.promise)
        await updateDocument(ctx, {
          documentId: doc.documentId,
          expectedRevision: 1,
          data: { title: 'Winner' },
        })
      } finally {
        release.release()
      }
      expect(await bounded(loser)).toMatchObject({ error: { code: 'ERR_DOCUMENT_STALE' } })
      expect(beforeUpdate).toHaveBeenCalledOnce()
      expect(afterUpdate).not.toHaveBeenCalled()
      const after = await state(doc.documentId)
      expect(after.revision).toBe(2)
      expect(after.document?.fields).toEqual({ title: 'Winner' })
    })
    it('rejects already-stale replacements before user preparation', async () => {
      const doc = await create()
      await combined(doc.documentId)
      const beforeUpdate = vi.fn()
      await expect(
        updateDocument(
          { ...ctx, definition: { ...definition, hooks: { beforeUpdate } } },
          { documentId: doc.documentId, expectedRevision: 1, data: { title: 'Old' } }
        )
      ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
      expect(beforeUpdate).not.toHaveBeenCalled()
    })
    it('reports the committed revision when an after-hook fails', async () => {
      const doc = await create()
      await expect(
        updateDocument(
          {
            ...ctx,
            definition: {
              ...definition,
              hooks: {
                afterUpdate: () => {
                  throw new Error('notification failed')
                },
              },
            },
          },
          { documentId: doc.documentId, expectedRevision: 1, data: { title: 'Committed' } }
        )
      ).rejects.toMatchObject({
        code: 'ERR_DOCUMENT_HOOK_COMMITTED',
        details: { revision: 2, documentId: doc.documentId },
      })
      expect((await state(doc.documentId)).revision).toBe(2)
    })
    it.each([undefined, null, 0, -1, 1.5, '1', Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
      'rejects malformed revision %s before preparation',
      async (expectedRevision) => {
        const doc = await create()
        const beforeUpdate = vi.fn()
        const scoped = { ...ctx, definition: { ...definition, hooks: { beforeUpdate } } }
        await expect(
          Reflect.apply(updateDocument, undefined, [
            scoped,
            { documentId: doc.documentId, expectedRevision, data: { title: 'Invalid' } },
          ])
        ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
        expect(beforeUpdate).not.toHaveBeenCalled()
        expect((await state(doc.documentId)).revision).toBe(1)
      }
    )
    it('rejects public lifecycle writes inside externally owned transactions', async () => {
      const doc = await create()
      await expect(db.withTransaction(() => combined(doc.documentId))).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        details: { reason: 'external_lifecycle_transaction' },
      })
      expect((await state(doc.documentId)).revision).toBe(1)
    })
  })
}
