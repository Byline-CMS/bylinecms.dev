/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type {
  BeforeSingletonSaveContext,
  BylineCore,
  BylineLogger,
  IDbAdapter,
  IStorageProvider,
  MultiCollectionDefinition,
  SingletonDefinition,
  UploadImageProcessor,
} from '@byline/core'
import { ErrorCodes, getAvailableTransitions, SINGLE_STATUS_WORKFLOW } from '@byline/core'
import { runScheduledPublicationSweep } from '@byline/core/scheduler'
import {
  changeDocumentStatus,
  copySingletonToLocale,
  type DocumentLifecycleContext,
  populateDocuments,
  restoreSingletonVersion,
  scheduleDocumentPublish,
  unpublishDocument,
  updateSingleton,
  uploadField,
} from '@byline/core/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()
const slotNames = [
  'concurrent',
  'locale',
  'published',
  'after-save',
  'copy',
  'discriminators',
  'single-status',
  'workflow',
  'schedule',
  'history-restore',
  'populate',
  'upload',
] as const
type SlotName = (typeof slotNames)[number]

const definitions = Object.fromEntries(
  slotNames.map((name) => [
    name,
    {
      path: `singleton-lifecycle-${name}-${timestamp}`,
      label: `Singleton lifecycle ${name}`,
      singleton: true,
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'tagline', type: 'text', localized: true, optional: true },
      ],
    } satisfies SingletonDefinition,
  ])
) as Record<SlotName, SingletonDefinition>

const populateTargetDefinition: MultiCollectionDefinition = {
  path: `singleton-lifecycle-populate-target-${timestamp}`,
  labels: { singular: 'Populate target', plural: 'Populate targets' },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'parent',
      type: 'relation',
      targetCollection: `singleton-lifecycle-populate-target-${timestamp}`,
      optional: true,
    },
  ],
}

definitions['single-status'].workflow = SINGLE_STATUS_WORKFLOW
definitions.populate.fields = [
  { name: 'title', type: 'text' },
  {
    name: 'featured',
    type: 'relation',
    targetCollection: populateTargetDefinition.path,
  },
]
definitions.upload.fields = [
  { name: 'title', type: 'text' },
  {
    name: 'hero',
    type: 'image',
    optional: true,
    upload: {
      mimeTypes: ['image/png'],
      sizes: [{ name: 'thumbnail', width: 400, height: 400, fit: 'cover' }],
    },
  },
]

const noopLogger: BylineLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}

export function singletonLifecycleSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  const collectionIds = {} as Record<SlotName, string>
  let populateTargetCollectionId: string

  function context(name: SlotName): DocumentLifecycleContext {
    const definition = definitions[name]
    return {
      db: adapter,
      definition,
      collectionId: collectionIds[name],
      collectionVersion: 1,
      collectionPath: definition.path,
      defaultLocale: 'en',
      logger: noopLogger,
      requestContext: createSuperAdminContext(),
    }
  }

  async function read(
    name: SlotName,
    locale: string,
    readMode: 'any' | 'published' = 'any',
    onMissingLocale: 'empty' | 'fallback' | 'omit' = 'omit'
  ) {
    const documentId = await adapter.queries.singletons.getMappedDocumentId(collectionIds[name])
    if (documentId == null) return null
    return adapter.queries.documents.getDocumentById({
      collection_id: collectionIds[name],
      document_id: documentId,
      locale,
      reconstruct: true,
      readMode,
      onMissingLocale,
    })
  }

  function sweepCore(name: SlotName): BylineCore {
    const definition = definitions[name]
    return {
      config: { i18n: { content: { defaultLocale: 'en' } } },
      collections: [definition],
      db: adapter,
      storage: undefined,
      logger: noopLogger,
      collectionRecords: new Map([
        [
          definition.path,
          { collectionId: collectionIds[name], version: 1, schemaHash: 'conformance' },
        ],
      ]),
    } as unknown as BylineCore
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  describe('singleton lifecycle', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([...Object.values(definitions), populateTargetDefinition])
      for (const name of slotNames) {
        const created = await adapter.commands.collections.create(
          definitions[name].path,
          definitions[name]
        )
        const row = created[0]
        if (row == null) throw new Error(`Failed to register singleton lifecycle slot '${name}'`)
        collectionIds[name] = row.id as string
      }
      const targetRows = await adapter.commands.collections.create(
        populateTargetDefinition.path,
        populateTargetDefinition
      )
      const targetRow = targetRows[0]
      if (targetRow == null) throw new Error('Failed to register singleton populate target')
      populateTargetCollectionId = targetRow.id as string
    })

    afterAll(async () => {
      for (const name of slotNames) {
        const collectionId = collectionIds[name]
        if (collectionId == null) continue
        try {
          await adapter.commands.collections.delete(collectionId)
        } catch (error) {
          console.error('Failed to cleanup singleton lifecycle collection:', error)
        }
      }
      if (populateTargetCollectionId != null) {
        try {
          await adapter.commands.collections.delete(populateTargetCollectionId)
        } catch (error) {
          console.error('Failed to cleanup singleton populate target:', error)
        }
      }
    })

    it('serializes concurrent first saves through the registered-slot lock', async () => {
      const observe = hooks.observeSingletonContention
      if (observe == null) {
        throw new Error('singleton lifecycle conformance requires observeSingletonContention')
      }
      let releaseFirst!: () => void
      const release = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      let firstHookEntered!: () => void
      const entered = new Promise<void>((resolve) => {
        firstHookEntered = resolve
      })
      const initialFlags: boolean[] = []
      definitions.concurrent.hooks = {
        beforeSave: async (hookContext) => {
          initialFlags.push(hookContext.isInitialSave)
          if (initialFlags.length === 1) {
            firstHookEntered()
            await release
          }
        },
      }

      const observation = await observe(async (waitForTwoConnections) => {
        const first = updateSingleton(context('concurrent'), { data: { title: 'First' } })
        await entered
        const second = updateSingleton(context('concurrent'), { data: { title: 'Second' } })
        await waitForTwoConnections()
        expect(initialFlags).toEqual([true])
        releaseFirst()
        return Promise.all([first, second])
      })

      expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
      expect(observation.result[0].documentId).toBe(observation.result[1].documentId)
      expect(observation.result[0].documentVersionId).not.toBe(
        observation.result[1].documentVersionId
      )
      expect(initialFlags).toEqual([true, false])
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds.concurrent)
      ).resolves.toBe(observation.result[0].documentId)
    })

    it('writes later locales onto the same logical singleton document', async () => {
      const initial = await updateSingleton(context('locale'), { data: { title: 'English' } })

      await expect(read('locale', 'th')).resolves.toBeNull()
      expect((await read('locale', 'th', 'any', 'fallback'))?.fields).toMatchObject({
        title: 'English',
      })
      expect((await read('locale', 'th', 'any', 'empty'))?.fields.title).toBeUndefined()

      const translated = await updateSingleton(context('locale'), {
        data: { title: 'ภาษาไทย' },
        locale: 'th',
      })

      expect(translated.documentId).toBe(initial.documentId)
      expect((await read('locale', 'en'))?.fields).toMatchObject({ title: 'English' })
      expect((await read('locale', 'th'))?.fields).toMatchObject({ title: 'ภาษาไทย' })
    })

    it('inherits single-status and default workflow behaviour', async () => {
      const singleStatus = await updateSingleton(context('single-status'), {
        data: { title: 'Immediately public' },
      })
      expect((await read('single-status', 'en', 'published'))?.status).toBe('published')
      expect(getAvailableTransitions(SINGLE_STATUS_WORKFLOW, 'published')).toEqual([])
      await expect(
        changeDocumentStatus(context('single-status'), {
          documentId: singleStatus.documentId,
          nextStatus: 'draft',
        })
      ).rejects.toMatchObject({ code: 'ERR_INVALID_TRANSITION' })

      const editorial = await updateSingleton(context('workflow'), {
        data: { title: 'Editorial singleton' },
      })
      expect((await read('workflow', 'en', 'any'))?.status).toBe('draft')
      expect(await read('workflow', 'en', 'published')).toBeNull()

      await changeDocumentStatus(context('workflow'), {
        documentId: editorial.documentId,
        nextStatus: 'published',
      })
      expect((await read('workflow', 'en', 'published'))?.status).toBe('published')

      await expect(
        unpublishDocument(context('workflow'), { documentId: editorial.documentId })
      ).resolves.toEqual({ archivedCount: 1 })
      expect(await read('workflow', 'en', 'published')).toBeNull()
    })

    it('publishes a due singleton schedule through status hooks', async () => {
      const statusEvents: string[] = []
      definitions.schedule.hooks = {
        beforeStatusChange: ({ previousStatus, nextStatus }) => {
          statusEvents.push(`before:${previousStatus}:${nextStatus}`)
        },
        afterStatusChange: ({ previousStatus, nextStatus }) => {
          statusEvents.push(`after:${previousStatus}:${nextStatus}`)
        },
      }
      const saved = await updateSingleton(context('schedule'), {
        data: { title: 'Scheduled singleton' },
      })
      await scheduleDocumentPublish(context('schedule'), {
        documentId: saved.documentId,
        expectedVersionId: saved.documentVersionId,
        publishAt: new Date(Date.now() + 250).toISOString(),
      })

      await sleep(300)
      await expect(
        runScheduledPublicationSweep(sweepCore('schedule'), { batchSize: 1 })
      ).resolves.toEqual({ published: 1, failed: 0, workRemaining: false })
      expect(statusEvents).toEqual(['before:draft:published', 'after:draft:published'])
      expect((await read('schedule', 'en', 'published'))?.status).toBe('published')
      await expect(
        adapter.queries.documents.publishSchedules.get({
          documentId: saved.documentId,
          collectionId: collectionIds.schedule,
        })
      ).resolves.toBeNull()
    })

    it('accumulates history and restores a version through singleton save hooks', async () => {
      const first = await updateSingleton(context('history-restore'), {
        data: { title: 'First version' },
      })
      const second = await updateSingleton(context('history-restore'), {
        data: { title: 'Second version' },
      })
      const hookEvents: string[] = []
      definitions['history-restore'].hooks = {
        beforeSave: ({ operation }) => {
          hookEvents.push(`before:${operation.type}`)
        },
        afterSave: ({ operation }) => {
          hookEvents.push(`after:${operation.type}`)
        },
      }

      const restored = await restoreSingletonVersion(context('history-restore'), {
        sourceVersionId: first.documentVersionId,
      })
      expect(restored.documentId).toBe(first.documentId)
      expect(restored.documentVersionId).not.toBe(first.documentVersionId)
      expect(restored.documentVersionId).not.toBe(second.documentVersionId)
      expect(hookEvents).toEqual(['before:restore', 'after:restore'])
      expect((await read('history-restore', 'en'))?.fields).toMatchObject({
        title: 'First version',
      })

      const history = await adapter.queries.documents.getDocumentHistory({
        collection_id: collectionIds['history-restore'],
        document_id: first.documentId,
        page: 1,
        page_size: 10,
      })
      expect(history.meta).toMatchObject({ total: 3, page: 1, page_size: 10, total_pages: 1 })
      expect(new Set(history.documents.map((version) => version.document_version_id))).toEqual(
        new Set([first.documentVersionId, second.documentVersionId, restored.documentVersionId])
      )
    })

    it('populates a singleton relation with the shared depth and cycle guards', async () => {
      const initialTarget = await adapter.commands.documents.createDocumentVersion({
        collectionId: populateTargetCollectionId,
        collectionVersion: 1,
        collectionConfig: populateTargetDefinition,
        action: 'create',
        documentData: { title: 'Linked target' },
        path: `singleton-populate-target-${timestamp}`,
        status: 'published',
      })
      const targetDocumentId = initialTarget.document.document_id as string
      await adapter.commands.documents.createDocumentVersion({
        documentId: targetDocumentId,
        collectionId: populateTargetCollectionId,
        collectionVersion: 1,
        collectionConfig: populateTargetDefinition,
        action: 'update',
        documentData: {
          title: 'Linked target',
          parent: {
            targetDocumentId,
            targetCollectionId: populateTargetCollectionId,
          },
        },
        previousVersionId: initialTarget.document.id as string,
        path: `singleton-populate-target-${timestamp}`,
        status: 'published',
      })
      const saved = await updateSingleton(context('populate'), {
        data: {
          title: 'Populated singleton',
          featured: {
            targetDocumentId,
            targetCollectionId: populateTargetCollectionId,
          },
        },
      })
      const raw = await adapter.queries.documents.getDocumentById({
        collection_id: collectionIds.populate,
        document_id: saved.documentId,
        locale: 'en',
        readMode: 'any',
      })
      if (raw == null) throw new Error('Failed to read singleton populate fixture')

      const depthOne = structuredClone(raw) as Record<string, any>
      await populateDocuments({
        db: adapter,
        collections: [...Object.values(definitions), populateTargetDefinition],
        collectionId: collectionIds.populate,
        documents: [depthOne],
        populate: '*',
        depth: 1,
        locale: 'en',
        readMode: 'any',
      })
      expect(depthOne.fields.featured).toMatchObject({
        _resolved: true,
        document: { fields: { title: 'Linked target' } },
      })
      expect(depthOne.fields.featured.document.fields.parent._resolved).toBeUndefined()

      const depthTwo = structuredClone(raw) as Record<string, any>
      await populateDocuments({
        db: adapter,
        collections: [...Object.values(definitions), populateTargetDefinition],
        collectionId: collectionIds.populate,
        documents: [depthTwo],
        populate: '*',
        depth: 2,
        locale: 'en',
        readMode: 'any',
      })
      expect(depthTwo.fields.featured.document.fields.parent).toMatchObject({
        targetDocumentId,
        _resolved: true,
        _cycle: true,
      })
    })

    it('stores singleton upload variants and retrieves them after a save', async () => {
      const storage: IStorageProvider = {
        providerName: 'conformance',
        upload: vi.fn(async () => ({
          storageProvider: 'conformance',
          storagePath: 'singletons/hero.png',
          storageUrl: '/uploads/singletons/hero.png',
        })),
        delete: vi.fn(async () => undefined),
        getUrl: (storagePath) => `/uploads/${storagePath}`,
      }
      const imageProcessor: UploadImageProcessor = {
        extractMeta: vi.fn(async () => ({ width: 1200, height: 800, format: 'png' })),
        generateVariants: vi.fn(async () => [
          {
            name: 'thumbnail',
            storagePath: 'singletons/hero-thumbnail.webp',
            width: 400,
            height: 400,
            format: 'webp',
          },
        ]),
      }
      await updateSingleton(context('upload'), { data: { title: 'Before upload' } })
      const uploaded = await uploadField(
        {
          ...context('upload'),
          fieldName: 'hero',
          storage,
          imageProcessor,
        },
        {
          buffer: Buffer.from('png'),
          originalFilename: 'Hero.png',
          mimeType: 'image/png',
          fileSize: 3,
          shouldCreateDocument: false,
        }
      )
      const saved = await updateSingleton(context('upload'), {
        data: { title: 'After upload', hero: uploaded.storedFile },
      })

      expect(storage.upload).toHaveBeenCalledOnce()
      expect(imageProcessor.generateVariants).toHaveBeenCalledOnce()
      expect((await read('upload', 'en'))?.fields).toMatchObject({
        title: 'After upload',
        hero: {
          filename: 'hero.png',
          imageWidth: 1200,
          imageHeight: 800,
          variants: [
            {
              name: 'thumbnail',
              storagePath: 'singletons/hero-thumbnail.webp',
              width: 400,
              height: 400,
              format: 'webp',
            },
          ],
        },
      })
      expect(saved.documentId).toBe(
        await adapter.queries.singletons.getMappedDocumentId(collectionIds.upload)
      )
    })

    it('keeps published content readable behind a newer current draft', async () => {
      const first = await updateSingleton(context('published'), {
        data: { title: 'Published value' },
      })
      await adapter.commands.documents.setDocumentStatus({
        document_version_id: first.documentVersionId,
        status: 'published',
      })
      await updateSingleton(context('published'), { data: { title: 'Draft value' } })

      expect((await read('published', 'en', 'published'))?.fields).toMatchObject({
        title: 'Published value',
      })
      expect((await read('published', 'en', 'any'))?.fields).toMatchObject({
        title: 'Draft value',
      })
    })

    it('runs afterSave after commit and preserves the save when that hook throws', async () => {
      const definition = definitions['after-save']
      definition.hooks = {
        afterSave: async ({ documentId, documentVersionId }) => {
          const mapped = await adapter.queries.singletons.getMappedDocumentId(
            collectionIds['after-save']
          )
          const visible = await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: collectionIds['after-save'],
            document_id: documentId,
          })
          expect(mapped).toBe(documentId)
          expect(visible?.document_version_id).toBe(documentVersionId)
          throw new Error('afterSave observer failed')
        },
      }

      await expect(
        updateSingleton(context('after-save'), { data: { title: 'Committed value' } })
      ).rejects.toMatchObject({
        code: ErrorCodes.DOCUMENT_HOOK_COMMITTED,
        details: { phase: 'afterSave', sideEffectCode: ErrorCodes.UNHANDLED },
      })
      expect((await read('after-save', 'en'))?.fields).toMatchObject({
        title: 'Committed value',
      })
    })

    it('copies locale data on the mapped document without creating another slot', async () => {
      const initial = await updateSingleton(context('copy'), {
        data: { title: 'English', tagline: 'Source' },
      })
      const translated = await updateSingleton(context('copy'), {
        data: { title: 'ภาษาไทย', tagline: '' },
        locale: 'th',
      })
      const hookEvents: string[] = []
      definitions.copy.hooks = {
        beforeSave: ({ operation }) => {
          hookEvents.push(`before:${operation.type}`)
        },
        afterSave: ({ operation }) => {
          hookEvents.push(`after:${operation.type}`)
        },
      }

      const copied = await copySingletonToLocale(context('copy'), {
        sourceLocale: 'en',
        targetLocale: 'th',
        overwrite: true,
      })

      expect(copied.documentId).toBe(initial.documentId)
      expect(copied.documentVersionId).not.toBe(translated.documentVersionId)
      expect(hookEvents).toEqual(['before:copyToLocale', 'after:copyToLocale'])
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds.copy)
      ).resolves.toBe(initial.documentId)
      expect((await read('copy', 'th'))?.fields).toMatchObject({
        title: 'English',
        tagline: 'Source',
      })
    })

    it('pins save, restore, and copy-to-locale hook discriminator shapes', async () => {
      const contexts: BeforeSingletonSaveContext[] = []
      definitions.discriminators.hooks = {
        beforeSave: (hookContext) => {
          contexts.push({
            ...hookContext,
            data: structuredClone(hookContext.data),
            originalData:
              hookContext.originalData == null ? null : structuredClone(hookContext.originalData),
            operation: structuredClone(hookContext.operation),
          })
        },
      }
      const first = await updateSingleton(context('discriminators'), {
        data: { title: 'First', tagline: 'Fill me' },
      })
      await updateSingleton(context('discriminators'), {
        data: { title: 'Current', tagline: 'Current tagline' },
      })
      await restoreSingletonVersion(context('discriminators'), {
        sourceVersionId: first.documentVersionId,
      })
      await updateSingleton(context('discriminators'), {
        data: { title: 'เป้าหมาย', tagline: '' },
        locale: 'th',
      })
      await copySingletonToLocale(context('discriminators'), {
        sourceLocale: 'en',
        targetLocale: 'th',
        overwrite: false,
      })
      await copySingletonToLocale(context('discriminators'), {
        sourceLocale: 'en',
        targetLocale: 'th',
        overwrite: true,
      })

      expect(contexts[0]).toEqual(
        expect.objectContaining({
          operation: { type: 'save' },
          locale: 'en',
          data: { title: 'First', tagline: 'Fill me' },
          originalData: null,
        })
      )
      expect(contexts[2]).toEqual(
        expect.objectContaining({
          operation: { type: 'restore', sourceVersionId: first.documentVersionId },
          locale: 'all',
          data: expect.objectContaining({ title: expect.objectContaining({ en: 'First' }) }),
          originalData: expect.objectContaining({
            title: expect.objectContaining({ en: 'Current' }),
          }),
        })
      )
      expect(contexts[4]).toEqual(
        expect.objectContaining({
          operation: expect.objectContaining({ type: 'copyToLocale', overwrite: false }),
          locale: 'th',
          originalData: expect.objectContaining({ title: 'เป้าหมาย' }),
          data: expect.objectContaining({ title: 'เป้าหมาย', tagline: 'Fill me' }),
        })
      )
      expect(contexts[5]).toEqual(
        expect.objectContaining({
          operation: expect.objectContaining({ type: 'copyToLocale', overwrite: true }),
          data: expect.objectContaining({ title: 'First', tagline: 'Fill me' }),
        })
      )
    })
  })
}
