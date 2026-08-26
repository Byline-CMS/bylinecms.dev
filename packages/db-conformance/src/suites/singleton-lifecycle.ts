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
  BylineLogger,
  IDbAdapter,
  SingletonDefinition,
} from '@byline/core'
import {
  copySingletonToLocale,
  type DocumentLifecycleContext,
  restoreSingletonVersion,
  updateSingleton,
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

  async function read(name: SlotName, locale: string, readMode: 'any' | 'published' = 'any') {
    const documentId = await adapter.queries.singletons.getMappedDocumentId(collectionIds[name])
    if (documentId == null) return null
    return adapter.queries.documents.getDocumentById({
      collection_id: collectionIds[name],
      document_id: documentId,
      locale,
      reconstruct: true,
      readMode,
      onMissingLocale: 'omit',
    })
  }

  describe('singleton lifecycle', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter(Object.values(definitions))
      for (const name of slotNames) {
        const created = await adapter.commands.collections.create(
          definitions[name].path,
          definitions[name]
        )
        const row = created[0]
        if (row == null) throw new Error(`Failed to register singleton lifecycle slot '${name}'`)
        collectionIds[name] = row.id as string
      }
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
      const translated = await updateSingleton(context('locale'), {
        data: { title: 'ภาษาไทย' },
        locale: 'th',
      })

      expect(translated.documentId).toBe(initial.documentId)
      expect((await read('locale', 'en'))?.fields).toMatchObject({ title: 'English' })
      expect((await read('locale', 'th'))?.fields).toMatchObject({ title: 'ภาษาไทย' })
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
      ).rejects.toThrow('afterSave observer failed')
      expect((await read('after-save', 'en'))?.fields).toMatchObject({
        title: 'Committed value',
      })
    })

    it('copies locale data on the mapped document without creating another slot', async () => {
      const initial = await updateSingleton(context('copy'), {
        data: { title: 'English', tagline: 'Source' },
      })
      await updateSingleton(context('copy'), {
        data: { title: 'ภาษาไทย', tagline: '' },
        locale: 'th',
      })

      const copied = await copySingletonToLocale(context('copy'), {
        sourceLocale: 'en',
        targetLocale: 'th',
        overwrite: true,
      })

      expect(copied.documentId).toBe(initial.documentId)
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
