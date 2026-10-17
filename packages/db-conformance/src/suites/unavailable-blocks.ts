/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type {
  BlocksField,
  BylineLogger,
  IDbAdapter,
  MultiCollectionDefinition,
  SingletonDefinition,
} from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import {
  copyToLocale,
  type DocumentLifecycleContext,
  deleteLocale,
  duplicateDocument,
  restoreDocumentVersion,
  updateDocument,
  updateDocumentWithPatches,
  updateSingleton,
} from '@byline/core/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

export function unavailableBlocksSuite(hooks: ConformanceHooks) {
  describe('Unavailable blocks', () => {
    const live = {
      blockType: 'live',
      fields: [{ name: 'text', type: 'text' as const, localized: true }],
    }
    const retired = { ...live, blockType: 'retired' }
    const content: BlocksField = { name: 'content', type: 'blocks', blocks: [live, retired] }
    const definition: MultiCollectionDefinition = {
      path: 'unavailable-blocks',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [content],
    }
    const singletonContent = { ...content }
    const singleton: SingletonDefinition = {
      path: 'unavailable-singleton',
      singleton: true,
      label: 'Settings',
      fields: [singletonContent],
    }
    const logger = Object.fromEntries(
      ['log', 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((key) => [
        key,
        vi.fn(),
      ])
    ) as unknown as BylineLogger
    const loggerKey = Symbol.for('__byline_logger__')
    const globals = globalThis as Record<symbol, unknown>
    let previousLogger: unknown
    let adapter: IDbAdapter
    let collectionId: string
    let singletonId: string
    const context = (single = false): DocumentLifecycleContext => ({
      db: adapter,
      definition: single ? singleton : definition,
      collectionPath: single ? singleton.path : definition.path,
      collectionId: single ? singletonId : collectionId,
      collectionVersion: 1,
      defaultLocale: 'en',
      logger,
      requestContext: createSuperAdminContext(),
    })
    const read = (id: string, lenient = false) =>
      adapter.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: id,
        locale: 'all',
        reconstruct: true,
        lenient,
        localeVisibility: 'public',
      })
    const revision = (id: string) =>
      adapter.queries.documents.getDocumentRevision({
        collection_id: collectionId,
        document_id: id,
      })
    async function seed(types = ['retired', 'live', 'live']) {
      content.blocks = [live, retired]
      const saved = await adapter.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        action: 'create',
        documentData: {
          content: types.map((_type, i) => ({
            _type,
            text: { en: `${_type}-${i}`, fr: `${_type}-${i}-fr` },
          })),
        },
        locale: 'all',
        status: 'published',
      })
      content.blocks = [live]
      return { id: saved.document.document_id, versionId: saved.document.id }
    }
    beforeAll(async () => {
      await hooks.truncate()
      previousLogger = globals[loggerKey]
      defineLogger(logger)
      adapter = await hooks.createAdapter([definition, singleton])
      collectionId = (await adapter.commands.collections.create(definition.path, definition))[0]!.id
      singletonId = (await adapter.commands.collections.create(singleton.path, singleton))[0]!.id
    })
    afterAll(() => {
      if (previousLogger === undefined) delete globals[loggerKey]
      else globals[loggerKey] = previousLogger
    })

    for (const types of [
      ['retired', 'live'],
      ['live', 'retired', 'live'],
      ['live', 'retired'],
      ['retired'],
    ]) {
      it(`keeps strict, lenient, list, populate and version reads usable: ${types}`, async () => {
        const { id, versionId } = await seed(types)
        const first = await read(id)
        const second = await read(id, true)
        const publicRead = await adapter.queries.documents.getDocumentById({
          collection_id: collectionId,
          document_id: id,
          locale: 'en',
          reconstruct: true,
          readMode: 'published',
          localeVisibility: 'public',
        })
        const history = await adapter.queries.documents.getDocumentHistory({
          collection_id: collectionId,
          document_id: id,
          locale: 'all',
        })
        const version = await adapter.queries.documents.getDocumentByVersion({
          document_version_id: versionId,
          locale: 'all',
        })
        const populated = await adapter.queries.documents.getDocumentsByDocumentIds({
          collection_id: collectionId,
          document_ids: [id],
          locale: 'all',
          localeVisibility: 'public',
        })
        const listed = await adapter.queries.documents.findDocuments({
          collection_id: collectionId,
          locale: 'all',
          pageSize: 100,
          localeVisibility: 'public',
        })
        for (const doc of [
          first,
          second,
          publicRead,
          history.documents[0],
          version,
          populated[0],
          listed.documents.find((doc) => doc.document_id === id),
        ]) {
          expect(doc.fields.content.map((item: any) => item._type)).toEqual(
            types.filter((type) => type === 'live')
          )
          expect(doc.unavailableBlocks).toEqual([
            expect.objectContaining({
              fieldPath: 'content',
              storedIndex: types.indexOf('retired'),
              blockType: 'retired',
              id: expect.any(String),
            }),
          ])
          expect(doc.restoreWarnings).toBeUndefined()
        }
        expect(
          vi
            .mocked(logger.warn)
            .mock.calls.filter(
              ([data]) => typeof data === 'object' && data?.versionId === versionId
            )
        ).toHaveLength(1)
      })
    }

    it('patches the compacted index and recovers historical blocks after re-declaration', async () => {
      const { id, versionId } = await seed()
      const before = await read(id)
      await updateDocumentWithPatches(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        patches: [{ kind: 'field.set', path: 'content[1].text', value: 'edited' }],
      })
      const saved = await read(id)
      expect(saved.unavailableBlocks).toBeUndefined()
      expect(saved.fields.content.map((item: any) => item._id)).toEqual(
        before.fields.content.map((item: any) => item._id)
      )
      expect(saved.fields.content[1].text.en).toBe('edited')
      expect(saved.fields.content[1].text.fr).toBe('live-2-fr')
      content.blocks = [live, retired]
      await restoreDocumentVersion(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        sourceVersionId: versionId,
      })
      const recovered = await read(id)
      expect(recovered.fields.content.map((item: any) => item._type)).toEqual([
        'retired',
        'live',
        'live',
      ])
      expect(recovered.fields.content[2].text.en).toBe('live-2')
    })

    it('preserves other locales by identity when a single-locale save reorders survivors', async () => {
      const { id } = await seed()
      const before = await adapter.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: id,
        locale: 'en',
        reconstruct: true,
      })
      await updateDocument(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        data: { content: [...before.fields.content].reverse() },
      })
      content.blocks = [live, retired]
      const saved = await read(id)
      expect(saved.fields.content.map((item: any) => item.text)).toEqual([
        { en: 'live-2', fr: 'live-2-fr' },
        { en: 'live-1', fr: 'live-1-fr' },
      ])
    })

    it('preserves other locales at compacted positions in a payload without item IDs', async () => {
      const { id } = await seed()
      await updateDocument(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        data: {
          content: [
            { _type: 'live', text: 'first edited' },
            { _type: 'live', text: 'second edited' },
          ],
        },
      })
      content.blocks = [live, retired]
      const saved = await read(id)
      expect(saved.fields.content.map((item: any) => item.text)).toEqual([
        { en: 'first edited', fr: 'live-1-fr' },
        { en: 'second edited', fr: 'live-2-fr' },
      ])
      expect(saved.fields.content.map((item: any) => item._type)).toEqual(['live', 'live'])
    })

    it.each(['whole', 'duplicate', 'copy', 'delete', 'restore'] as const)(
      '%s writes omit unavailable content',
      async (operation) => {
        const { id, versionId } = await seed()
        let resultId = id
        const expectedRevision = (await revision(id))!
        if (operation === 'whole')
          await updateDocument(context(), {
            documentId: id,
            expectedRevision,
            data: (await read(id)).fields,
            locale: 'all',
          })
        if (operation === 'duplicate')
          resultId = (
            await duplicateDocument(context(), { sourceDocumentId: id, expectedRevision })
          ).documentId
        if (operation === 'copy')
          await copyToLocale(context(), {
            documentId: id,
            expectedRevision,
            sourceLocale: 'en',
            targetLocale: 'de',
            overwrite: true,
          })
        if (operation === 'delete')
          await deleteLocale(context(), { documentId: id, expectedRevision, locale: 'fr' })
        if (operation === 'restore') {
          await updateDocument(context(), {
            documentId: id,
            expectedRevision,
            data: (await read(id)).fields,
            locale: 'all',
          })
          await restoreDocumentVersion(context(), {
            documentId: id,
            expectedRevision: (await revision(id))!,
            sourceVersionId: versionId,
          })
        }
        // Re-enable the definition: absence here proves rows were omitted on write.
        content.blocks = [live, retired]
        const saved = await read(resultId)
        expect(saved.fields.content.map((item: any) => item._type)).toEqual(['live', 'live'])
        expect(saved.unavailableBlocks).toBeUndefined()
        if (operation === 'delete') {
          expect(saved.fields.content[0].text).toEqual({ en: 'live-1' })
        } else {
          expect(saved.fields.content[0].text.fr).toBe('live-1-fr')
        }
      }
    )

    it('singleton updates omit unavailable content', async () => {
      singletonContent.blocks = [live, retired]
      const initial = await updateSingleton(context(true), {
        expectedState: 'empty',
        data: {
          content: [
            { _type: 'retired', text: 'old' },
            { _type: 'live', text: 'live' },
          ],
        },
        locale: 'en',
      })
      singletonContent.blocks = [live]
      await updateSingleton(context(true), {
        expectedRevision: initial.revision,
        data: { content: [{ _type: 'live', text: 'edited' }] },
        locale: 'en',
      })
      singletonContent.blocks = [live, retired]
      const doc = await adapter.queries.documents.getDocumentById({
        collection_id: singletonId,
        document_id: initial.documentId,
        locale: 'en',
        reconstruct: true,
      })
      expect(doc.fields.content.map((item: any) => item._type)).toEqual(['live'])
    })
  })
}
