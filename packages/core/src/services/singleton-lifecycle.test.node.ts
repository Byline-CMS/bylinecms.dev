/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth, createRequestContext } from '@byline/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  copySingletonToLocale,
  resolveSingletonDocumentId,
  restoreSingletonVersion,
  updateSingleton,
} from './singleton-lifecycle/index.js'
import type { IDbAdapter, SingletonDefinition, SingletonHooks } from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'
import type { DocumentLifecycleContext } from './document-lifecycle/context.js'

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

interface HarnessOptions {
  mapped?: boolean
  softDeleted?: boolean
  hooks?: SingletonHooks
}

function createHarness(options: HarnessOptions = {}) {
  const definition: SingletonDefinition = {
    path: 'site-settings',
    label: 'Site settings',
    singleton: true,
    fields: [
      { name: 'title', type: 'text', localized: true },
      { name: 'count', type: 'integer', optional: true },
    ],
    hooks: options.hooks,
  }
  let mappedDocumentId = options.mapped ? 'doc-1' : null
  let currentVersion =
    options.mapped && !options.softDeleted
      ? {
          document_version_id: 'ver-current',
          document_id: 'doc-1',
          collection_id: 'col-1',
          status: 'draft',
          created_at: new Date('2026-08-25T00:00:00.000Z'),
          updated_at: new Date('2026-08-25T00:00:00.000Z'),
        }
      : null
  const views = new Map<string, Record<string, any>>()
  const versions = new Map<string, Record<string, any>>()
  if (options.mapped && !options.softDeleted) {
    views.set('en', { fields: { title: 'Before', count: 1 } })
    views.set('all', { fields: { title: { en: 'Before' }, count: 1 } })
  }

  let transactionDepth = 0
  let committedTransactions = 0
  let versionCounter = 0
  const withTransaction = vi.fn(async <T>(operation: () => Promise<T>): Promise<T> => {
    const isOuter = transactionDepth === 0
    transactionDepth++
    try {
      const result = await operation()
      transactionDepth--
      if (isOuter) committedTransactions++
      return result
    } catch (error) {
      transactionDepth--
      throw error
    }
  })
  const lockSlot = vi.fn(async () => {
    expect(transactionDepth).toBeGreaterThan(0)
  })
  const setMapping = vi.fn(async (_collectionId: string, documentId: string) => {
    mappedDocumentId = documentId
  })
  const createDocumentVersion = vi.fn(async (write: Record<string, any>) => {
    const documentId = (write.documentId as string | undefined) ?? 'doc-1'
    const documentVersionId = `ver-${++versionCounter}`
    currentVersion = {
      document_version_id: documentVersionId,
      document_id: documentId,
      collection_id: 'col-1',
      status: write.status as string,
      created_at: new Date('2026-08-25T00:00:00.000Z'),
      updated_at: new Date('2026-08-26T00:00:00.000Z'),
    }
    views.set(write.locale as string, { fields: write.documentData as Record<string, any> })
    return {
      document: { id: documentVersionId, document_id: documentId },
      fieldCount: Object.keys(write.documentData as Record<string, any>).length,
    }
  })
  const getMappedDocumentId = vi.fn(async () => mappedDocumentId)
  const getCurrentVersionMetadata = vi.fn(async () => currentVersion)
  const getDocumentById = vi.fn(async (params: Record<string, any>) => {
    if (mappedDocumentId == null || currentVersion == null) return null
    const locale = (params.locale as string | undefined) ?? 'en'
    const view = views.get(locale)
    if (view == null && params.onMissingLocale === 'omit') return null
    return {
      document_id: mappedDocumentId,
      document_version_id: currentVersion.document_version_id,
      status: currentVersion.status,
      fields: view?.fields ?? {},
    }
  })
  const getDocumentByVersion = vi.fn(async (params: Record<string, any>) =>
    versions.get(params.document_version_id as string)
  )

  const db = {
    classifyError: vi.fn(() => ({ code: 'DB_UNKNOWN' })),
    commands: {
      documents: {
        createDocumentVersion,
        publishSchedules: {
          suspendForContentEdit: vi.fn(async () => ({ status: 'schedule_not_found' })),
        },
      },
      counters: {
        nextCounterValue: vi.fn(async () => 1),
      },
      audit: { append: vi.fn(async () => ({ id: 'audit-1' })) },
      singletons: {
        lockSlot,
        setMapping,
        clearMapping: vi.fn(async () => {
          mappedDocumentId = null
        }),
      },
    },
    queries: {
      documents: {
        getCurrentVersionMetadata,
        getDocumentById,
        getDocumentByVersion,
      },
      singletons: { getMappedDocumentId },
    },
    withTransaction,
  } as unknown as IDbAdapter
  const actor = new AdminAuth({
    id: 'editor',
    abilities: ['singletons.site-settings.update'],
  })
  const ctx: DocumentLifecycleContext = {
    db,
    definition,
    collectionId: 'col-1',
    collectionVersion: 1,
    collectionPath: definition.path,
    defaultLocale: 'en',
    logger: noopLogger,
    requestContext: createRequestContext({ actor }),
  }

  return {
    ctx,
    definition,
    views,
    versions,
    createDocumentVersion,
    getMappedDocumentId,
    getCurrentVersionMetadata,
    getDocumentById,
    lockSlot,
    setMapping,
    withTransaction,
    isInTransaction: () => transactionDepth > 0,
    committedTransactions: () => committedTransactions,
    mappedDocumentId: () => mappedDocumentId,
    currentVersion: () => currentVersion,
  }
}

describe('singleton lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves null from the mapping before initial materialisation', async () => {
    const harness = createHarness()

    await expect(resolveSingletonDocumentId(harness.ctx)).resolves.toBeNull()
  })

  it('materialises once and fires save hooks around the committed transaction', async () => {
    const contexts: Record<string, any>[] = []
    let harness: ReturnType<typeof createHarness>
    harness = createHarness({
      hooks: {
        beforeSave: (context) => {
          expect(harness.isInTransaction()).toBe(true)
          contexts.push({ phase: 'before', ...context })
          context.data.title = 'Mutated by hook'
        },
        afterSave: (context) => {
          expect(harness.isInTransaction()).toBe(false)
          expect(harness.committedTransactions()).toBe(1)
          contexts.push({ phase: 'after', ...context })
        },
      },
    })

    const result = await updateSingleton(harness.ctx, { data: { title: 'Incoming' } })

    expect(result).toEqual({ documentId: 'doc-1', documentVersionId: 'ver-1' })
    expect(harness.lockSlot).toHaveBeenCalledOnce()
    expect(harness.setMapping).toHaveBeenCalledWith('col-1', 'doc-1')
    expect(harness.createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        documentData: { title: 'Mutated by hook' },
        locale: 'en',
      })
    )
    expect(harness.createDocumentVersion.mock.calls[0]?.[0]).not.toHaveProperty('documentId')
    expect(contexts).toEqual([
      expect.objectContaining({
        phase: 'before',
        isInitialSave: true,
        originalData: null,
        documentId: null,
        operation: { type: 'save' },
      }),
      expect.objectContaining({
        phase: 'after',
        isInitialSave: true,
        documentId: 'doc-1',
        documentVersionId: 'ver-1',
        operation: { type: 'save' },
      }),
    ])
  })

  it('updates the mapped document and supplies current field data to both hooks', async () => {
    const beforeSave = vi.fn((context: { data: Record<string, any> }) => {
      expect(context.data.count).toBe(2)
      context.data.count = '3'
    })
    const afterSave = vi.fn()
    const harness = createHarness({ mapped: true, hooks: { beforeSave, afterSave } })

    await updateSingleton(harness.ctx, {
      data: { title: 'After', count: '2' },
      expectedVersionId: 'ver-current',
    })

    expect(harness.setMapping).not.toHaveBeenCalled()
    expect(harness.createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        action: 'update',
        documentData: { title: 'After', count: 3 },
        previousVersionId: 'ver-current',
      })
    )
    expect(beforeSave).toHaveBeenCalledWith(
      expect.objectContaining({
        isInitialSave: false,
        documentId: 'doc-1',
        originalData: { title: 'Before', count: 1 },
      })
    )
    expect(afterSave).toHaveBeenCalledWith(
      expect.objectContaining({ isInitialSave: false, documentVersionId: 'ver-1' })
    )
  })

  it('rejects a missing update ability before any database work', async () => {
    const harness = createHarness()
    harness.ctx.requestContext = createRequestContext({
      actor: new AdminAuth({ id: 'reader', abilities: ['singletons.site-settings.read'] }),
    })

    await expect(updateSingleton(harness.ctx, { data: { title: 'No' } })).rejects.toMatchObject({
      code: 'ERR_FORBIDDEN',
    })
    expect(harness.lockSlot).not.toHaveBeenCalled()
    expect(harness.getMappedDocumentId).not.toHaveBeenCalled()
  })

  it('enforces expectedVersionId under the locked slot state', async () => {
    const current = createHarness({ mapped: true })
    await expect(
      updateSingleton(current.ctx, {
        data: { title: 'Yes' },
        expectedVersionId: 'ver-current',
      })
    ).resolves.toMatchObject({ documentId: 'doc-1' })

    const stale = createHarness({ mapped: true })
    await expect(
      updateSingleton(stale.ctx, { data: { title: 'No' }, expectedVersionId: 'ver-stale' })
    ).rejects.toMatchObject({ code: 'ERR_CONFLICT' })
    expect(stale.createDocumentVersion).not.toHaveBeenCalled()

    const unmaterialised = createHarness()
    await expect(
      updateSingleton(unmaterialised.ctx, {
        data: { title: 'No' },
        expectedVersionId: 'ver-believed-current',
      })
    ).rejects.toMatchObject({ code: 'ERR_CONFLICT' })
    expect(unmaterialised.createDocumentVersion).not.toHaveBeenCalled()
  })

  it('rejects a non-default first locale before document or mapping writes', async () => {
    const beforeSave = vi.fn()
    const harness = createHarness({ hooks: { beforeSave } })

    await expect(
      updateSingleton(harness.ctx, { data: { title: 'ไทย' }, locale: 'th' })
    ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(beforeSave).not.toHaveBeenCalled()
    expect(harness.createDocumentVersion).not.toHaveBeenCalled()
    expect(harness.setMapping).not.toHaveBeenCalled()
  })

  it('keeps a soft-deleted document mapped and rejects a replacement save', async () => {
    const harness = createHarness({ mapped: true, softDeleted: true })

    await expect(
      updateSingleton(harness.ctx, { data: { title: 'Replacement' } })
    ).rejects.toMatchObject({ code: 'ERR_CONFLICT' })
    expect(harness.mappedDocumentId()).toBe('doc-1')
    expect(harness.createDocumentVersion).not.toHaveBeenCalled()
    expect(harness.setMapping).not.toHaveBeenCalled()
  })

  it('leaves a committed version in place when afterSave rejects', async () => {
    const harness = createHarness({
      hooks: {
        afterSave: () => {
          throw new Error('notification failed')
        },
      },
    })

    await expect(updateSingleton(harness.ctx, { data: { title: 'Committed' } })).rejects.toThrow(
      'notification failed'
    )
    expect(harness.committedTransactions()).toBe(1)
    expect(harness.mappedDocumentId()).toBe('doc-1')
    expect(harness.currentVersion()?.document_version_id).toBe('ver-1')
  })

  it('restores complete all-locale data through the singleton save discriminator', async () => {
    const beforeSave = vi.fn()
    const afterSave = vi.fn()
    const harness = createHarness({ mapped: true, hooks: { beforeSave, afterSave } })
    harness.views.set('all', { fields: { title: { en: 'Current', th: 'ปัจจุบัน' }, count: 2 } })
    harness.versions.set('ver-source', {
      document_id: 'doc-1',
      fields: { title: { en: 'Historic', th: 'อดีต' }, count: 1 },
    })

    await restoreSingletonVersion(harness.ctx, { sourceVersionId: 'ver-source' })

    const hookShape = expect.objectContaining({
      data: { title: { en: 'Historic', th: 'อดีต' }, count: 1 },
      originalData: { title: { en: 'Current', th: 'ปัจจุบัน' }, count: 2 },
      locale: 'all',
      isInitialSave: false,
      operation: { type: 'restore', sourceVersionId: 'ver-source' },
    })
    expect(beforeSave).toHaveBeenCalledWith(hookShape)
    expect(afterSave).toHaveBeenCalledWith(hookShape)
    expect(harness.createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restore', locale: 'all' })
    )
  })

  it('copies the merged target payload and distinguishes overwrite modes', async () => {
    const run = async (overwrite: boolean) => {
      const beforeSave = vi.fn()
      const harness = createHarness({ mapped: true, hooks: { beforeSave } })
      harness.views.set('en', { fields: { title: 'Source', count: 1 } })
      harness.views.set('th', { fields: { title: 'Target', count: 1 } })

      await copySingletonToLocale(harness.ctx, {
        sourceLocale: 'en',
        targetLocale: 'th',
        overwrite,
      })
      return { context: beforeSave.mock.calls[0]?.[0], harness }
    }

    const preserving = await run(false)
    const overwriting = await run(true)
    expect(preserving.context).toEqual(
      expect.objectContaining({
        data: { title: 'Target', count: 1 },
        originalData: { title: 'Target', count: 1 },
        locale: 'th',
        operation: {
          type: 'copyToLocale',
          sourceLocale: 'en',
          targetLocale: 'th',
          overwrite: false,
        },
      })
    )
    expect(overwriting.context).toEqual(
      expect.objectContaining({
        data: { title: 'Source', count: 1 },
        operation: expect.objectContaining({ type: 'copyToLocale', overwrite: true }),
      })
    )
    expect(preserving.harness.setMapping).not.toHaveBeenCalled()
    expect(overwriting.harness.setMapping).not.toHaveBeenCalled()
  })
})
