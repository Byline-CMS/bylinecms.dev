/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type {
  BylineLogger,
  IDbAdapter,
  MultiCollectionDefinition,
  SingletonDefinition,
} from '@byline/core'
import { ERR_DATABASE } from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import {
  createDocument,
  type DocumentLifecycleContext,
  updateDocument,
  updateDocumentWithPatches,
  updateSingleton,
} from '@byline/core/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

export function structuralLocaleWritesSuite(hooks: ConformanceHooks) {
  describe('Structural locale writes', () => {
    const caption = { name: 'caption', type: 'text' as const, localized: true, optional: true }
    const children = { name: 'children', type: 'array' as const, optional: true, fields: [caption] }
    const fields: MultiCollectionDefinition['fields'] = [
      { name: 'title', type: 'text', localized: true, optional: true },
      {
        name: 'items',
        type: 'array',
        optional: true,
        fields: [caption, { name: 'meta', type: 'group', optional: true, fields: [children] }],
      },
      {
        name: 'content',
        type: 'blocks',
        optional: true,
        blocks: [
          { blockType: 'note', fields: [caption, children] },
          { blockType: 'quote', fields: [caption] },
        ],
      },
      { name: 'group', type: 'group', optional: true, fields: [children] },
    ]
    const definition: MultiCollectionDefinition = {
      path: 'structural-locale-writes',
      labels: { singular: 'Page', plural: 'Pages' },
      fields,
    }
    const singleton: SingletonDefinition = {
      path: 'structural-locale-singleton',
      singleton: true,
      label: 'Settings',
      fields,
    }
    const damagedSingletons: SingletonDefinition[] = ['one', 'three'].map((name) => ({
      path: `structural-damaged-${name}`,
      singleton: true,
      label: 'Damaged settings',
      fields: [{ name: 'items', type: 'group', optional: true, fields: [caption] }],
    }))
    const damagedIds: Record<string, string> = {}
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
    let solo: { adapter: IDbAdapter; close(): Promise<void> }
    const context = (single = false, db = adapter): DocumentLifecycleContext => ({
      db,
      definition: single ? singleton : definition,
      collectionPath: single ? singleton.path : definition.path,
      collectionId: single ? singletonId : collectionId,
      collectionVersion: 1,
      defaultLocale: 'en',
      logger,
      requestContext: createSuperAdminContext(),
    })
    const read = (id: string, locale: string, single = false) =>
      adapter.queries.documents.getDocumentById({
        collection_id: single ? singletonId : collectionId,
        document_id: id,
        locale,
        reconstruct: true,
      })
    const revision = (id: string) =>
      adapter.queries.documents.getDocumentRevision({
        collection_id: collectionId,
        document_id: id,
      })
    const localized = (value: string) => ({ en: value, fr: `${value}-fr` })
    const childData = (prefix: string) =>
      ['1', '2'].map((n) => ({ caption: localized(prefix + n) }))
    async function seed() {
      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        action: 'create',
        locale: 'all',
        status: 'published',
        documentData: {
          title: localized('Title'),
          items: ['A', 'B'].map((caption) => ({
            caption: localized(caption),
            meta: { children: childData(caption) },
          })),
          content: ['A', 'B'].map((caption) => ({
            _type: 'note',
            caption: localized(caption),
            children: childData(caption),
          })),
          group: { children: childData('G') },
        },
      })
      return result.document.document_id
    }
    const save = async (id: string, data: Record<string, any>, db = adapter) =>
      updateDocument(context(false, db), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        data,
      })
    beforeAll(async () => {
      await hooks.truncate()
      previousLogger = globals[loggerKey]
      defineLogger(logger)
      adapter = await hooks.createAdapter([definition, singleton, ...damagedSingletons])
      collectionId = (await adapter.commands.collections.create(definition.path, definition))[0]!.id
      singletonId = (await adapter.commands.collections.create(singleton.path, singleton))[0]!.id
      for (const damaged of damagedSingletons) {
        damagedIds[damaged.path] = (
          await adapter.commands.collections.create(damaged.path, damaged)
        )[0]!.id
      }
      solo = await hooks.createSingleConnectionAdapter([definition, singleton])
    })
    afterAll(async () => {
      try {
        await solo?.close()
      } finally {
        if (previousLogger === undefined) delete globals[loggerKey]
        else globals[loggerKey] = previousLogger
      }
    })

    for (const container of ['items', 'content']) {
      for (const mode of ['whole', 'patch'] as const) {
        it(`rejects duplicate ${container} IDs on a ${mode} save without changing any locale`, async () => {
          const id = await seed()
          const before = await read(id, 'all')
          const beforeRevision = await revision(id)
          const data = (await read(id, 'en')).fields
          data[container][1]._id = data[container][0]._id
          const attempt =
            mode === 'whole'
              ? save(id, data)
              : updateDocumentWithPatches(context(), {
                  documentId: id,
                  expectedRevision: beforeRevision!,
                  locale: 'en',
                  patches: [{ kind: 'field.set', path: container, value: data[container] }],
                })
          await expect(attempt).rejects.toMatchObject({
            code: 'ERR_VALIDATION',
            details: {
              reason: 'invalid_document_fields',
              issues: [
                {
                  field: container,
                  kind: 'invalid',
                  message: expect.stringContaining('unique _id'),
                },
              ],
            },
          })
          const after = await read(id, 'all')
          expect(after.document_version_id).toBe(before.document_version_id)
          expect(after.fields).toEqual(before.fields)
          expect(await revision(id)).toBe(beforeRevision)
        })
      }
    }

    it('rejects duplicate IDs on collection creation and singleton materialisation', async () => {
      const data = {
        items: [
          { _id: 'same', caption: 'A' },
          { _id: 'same', caption: 'B' },
        ],
      }
      const error = { code: 'ERR_VALIDATION', details: { reason: 'invalid_document_fields' } }
      await expect(createDocument(context(), { locale: 'en', data })).rejects.toMatchObject(error)
      await expect(
        updateSingleton(context(true), {
          expectedState: 'empty',
          locale: 'en',
          data,
        })
      ).rejects.toMatchObject(error)
    })

    it('does not relabel an unrelated database failure as content needing repair', async () => {
      const id = await seed()
      const beforeRevision = await revision(id)
      const data = (await read(id, 'en')).fields
      data.items.reverse()
      const failure = ERR_DATABASE({ message: 'Connection unavailable' })
      const mapRead = vi
        .spyOn(adapter.queries.documents, 'getDocumentByVersion')
        .mockRejectedValueOnce(failure)
      try {
        await expect(save(id, data)).rejects.toBe(failure)
        expect(await revision(id)).toBe(beforeRevision)
      } finally {
        mapRead.mockRestore()
      }
    })

    for (const operation of ['remove', 'reorder', 'insert', 'replace', 'clear', 'omit'] as const) {
      it(`${operation} keeps translations with surviving array and block identities`, async () => {
        const id = await seed()
        const data = (await read(id, 'en')).fields
        const edit = (items: any[], block = false) => {
          const fresh = {
            _id: crypto.randomUUID(),
            ...(block ? { _type: 'note' } : {}),
            caption: 'New',
          }
          switch (operation) {
            case 'remove':
              return items.slice(1)
            case 'reorder':
              return [...items].reverse()
            case 'insert':
              return [fresh, ...items]
            case 'replace':
              return [fresh, items[1]]
            case 'clear':
              return []
            case 'omit':
              return undefined
          }
        }
        const oldItems = data.items
        data.items = edit(data.items)
        data.content = edit(data.content, true)
        data.group.children = edit(data.group.children)
        await save(id, data)
        const french = (await read(id, 'fr')).fields
        const expected = {
          remove: ['B-fr'],
          reorder: ['B-fr', 'A-fr'],
          insert: [undefined, 'A-fr', 'B-fr'],
          replace: [undefined, 'B-fr'],
          clear: [],
          omit: [],
        }[operation]
        expect((french.items ?? []).map((item: any) => item.caption)).toEqual(expected)
        expect((french.content ?? []).map((item: any) => item.caption)).toEqual(expected)
        expect((french.group?.children ?? []).map((item: any) => item.caption)).toEqual(
          expected.map((value) => value?.replace('A-fr', 'G1-fr').replace('B-fr', 'G2-fr'))
        )
        expect(french.title).toBe('Title-fr')
        if (operation === 'remove') expect(french.items[0]._id).toBe(oldItems[1]._id)
      })
    }

    it('new ID-less items do not borrow translations from identified survivors', async () => {
      const id = await seed()
      const data = (await read(id, 'en')).fields
      data.items.unshift({ caption: 'New' })
      data.content.unshift({ _type: 'note', caption: 'New' })
      await save(id, data)
      const french = (await read(id, 'fr')).fields
      expect(french.items.map((item: any) => item.caption)).toEqual([undefined, 'A-fr', 'B-fr'])
      expect(french.content.map((item: any) => item.caption)).toEqual([undefined, 'A-fr', 'B-fr'])
      const english = (await read(id, 'en')).fields
      expect(english.items.map((item: any) => item.caption)).toEqual(['New', 'A', 'B'])
      expect(english.items[0]._id).toBeTruthy()
    })

    it('preserves nested translations when only inner arrays change', async () => {
      const id = await seed()
      const data = (await read(id, 'en')).fields
      data.items[0].meta.children.reverse()
      data.content[0].children.shift()
      await save(id, data)
      const french = (await read(id, 'fr')).fields
      expect(french.items[0].meta.children.map((item: any) => item.caption)).toEqual([
        'A2-fr',
        'A1-fr',
      ])
      expect(french.content[0].children.map((item: any) => item.caption)).toEqual(['A2-fr'])
      expect(french.items[1].meta.children.map((item: any) => item.caption)).toEqual([
        'B1-fr',
        'B2-fr',
      ])
    })

    it('removing a group containing arrays leaves no translated items behind', async () => {
      const id = await seed()
      const data = (await read(id, 'en')).fields
      delete data.group
      await save(id, data)
      expect((await read(id, 'fr')).fields.group).toBeUndefined()
    })

    it('editor remove and move patches preserve translations', async () => {
      const id = await seed()
      const data = (await read(id, 'en')).fields
      await updateDocumentWithPatches(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        patches: [
          { kind: 'array.remove', path: 'items', itemId: data.items[0]._id },
          { kind: 'block.move', path: 'content', blockId: data.content[1]._id, toIndex: 0 },
        ],
      })
      const french = (await read(id, 'fr')).fields
      expect(french.items.map((item: any) => item.caption)).toEqual(['B-fr'])
      expect(french.content.map((item: any) => item.caption)).toEqual(['B-fr', 'A-fr'])
    })

    it('changing a block type cannot inherit translations from its former type', async () => {
      const id = await seed()
      const data = (await read(id, 'en')).fields
      data.content[0] = { _id: data.content[0]._id, _type: 'quote', caption: 'New quote' }
      await save(id, data)
      const french = (await read(id, 'fr')).fields
      expect(french.content[0]._type).toBe('quote')
      expect(french.content[0].caption).toBeUndefined()
      expect(french.content[1].caption).toBe('B-fr')
    })

    for (const includeIds of [true, false]) {
      it(`value-only edits keep ordinary copy-forward (item IDs: ${includeIds})`, async () => {
        const id = await seed()
        const data = (await read(id, 'en')).fields
        data.items[0].caption = 'Edited'
        if (!includeIds) for (const item of data.items) delete item._id
        const mapRead = vi.spyOn(adapter.queries.documents, 'getDocumentByVersion')
        try {
          await save(id, data)
          expect(mapRead).not.toHaveBeenCalled()
        } finally {
          mapRead.mockRestore()
        }
        expect((await read(id, 'en')).fields.items[0].caption).toBe('Edited')
        expect((await read(id, 'fr')).fields.items.map((item: any) => item.caption)).toEqual([
          'A-fr',
          'B-fr',
        ])
      })
    }

    it('a structural save completes on a one-connection pool', async () => {
      const id = await seed()
      const data = (await read(id, 'en')).fields
      data.items.shift()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          save(id, data, solo.adapter),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('structural save waited for another connection')),
              5000
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
      expect((await read(id, 'fr')).fields.items[0].caption).toBe('B-fr')
    })

    it('a structural save in fr preserves both en and de translations', async () => {
      const saved = await adapter.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        action: 'create',
        locale: 'all',
        status: 'published',
        documentData: {
          items: ['A', 'B'].map((letter) => ({
            caption: { en: letter, fr: `${letter}-fr`, de: `${letter}-de` },
          })),
          content: ['A', 'B'].map((letter) => ({
            _type: 'note',
            caption: { en: letter, fr: `${letter}-fr`, de: `${letter}-de` },
          })),
        },
      })
      const id = saved.document.document_id
      const data = (await read(id, 'fr')).fields
      data.items.reverse()
      data.content.reverse()
      data.items[0].caption = 'B-edited-fr'
      data.content[0].caption = 'B-edited-fr'
      await updateDocument(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'fr',
        data,
      })
      const all = (await read(id, 'all')).fields
      const expected = [
        { en: 'B', fr: 'B-edited-fr', de: 'B-de' },
        { en: 'A', fr: 'A-fr', de: 'A-de' },
      ]
      expect(all.items.map((item: any) => item.caption)).toEqual(expected)
      expect(all.content.map((item: any) => item.caption)).toEqual(expected)
    })

    for (const mode of ['whole', 'patch'] as const) {
      it(`explains a damaged collection's ${mode} value-only save failure without changing stored data`, async () => {
        const id = await seed()
        const before = await read(id, 'all')
        const beforeRevision = (await revision(id))!
        const index = definition.fields.findIndex((field) => field.name === 'group')
        const original = definition.fields[index]!
        definition.fields[index] = {
          name: 'group',
          type: 'array',
          optional: true,
          fields: [caption],
        }
        try {
          const editable = await adapter.queries.documents.getDocumentById({
            collection_id: collectionId,
            document_id: id,
            locale: 'en',
            reconstruct: true,
            lenient: true,
          })
          expect(editable.restoreWarnings).toEqual(
            expect.arrayContaining([expect.stringMatching(/Invalid array index/)])
          )
          const attempt =
            mode === 'whole'
              ? save(id, { ...editable.fields, title: 'Edited title' })
              : updateDocumentWithPatches(context(), {
                  documentId: id,
                  expectedRevision: beforeRevision,
                  locale: 'en',
                  patches: [{ kind: 'field.set', path: 'title', value: 'Edited title' }],
                })
          await expect(attempt).rejects.toMatchObject({
            code: 'ERR_VALIDATION',
            message: expect.stringContaining('Ask a developer'),
            details: { reason: 'stored_content_requires_repair' },
          })
          expect(await revision(id)).toBe(beforeRevision)
        } finally {
          definition.fields[index] = original
        }
        const after = await read(id, 'all')
        expect(after.document_version_id).toBe(before.document_version_id)
        expect(after.fields).toEqual(before.fields)
      })
    }

    for (const [index, locales] of [['en'], ['en', 'fr', 'de']].entries()) {
      it(`rejects a damaged singleton structural save without changing stored data (${locales.length} locales)`, async () => {
        const damaged = damagedSingletons[index]!
        const damagedId = damagedIds[damaged.path]!
        const ctx: DocumentLifecycleContext = {
          ...context(true),
          definition: damaged,
          collectionPath: damaged.path,
          collectionId: damagedId,
        }
        let receipt = await updateSingleton(ctx, {
          expectedState: 'empty',
          locale: 'en',
          data: { items: { caption: 'en' } },
        })
        for (const locale of locales.slice(1)) {
          receipt = await updateSingleton(ctx, {
            expectedRevision: receipt.revision,
            locale,
            data: { items: { caption: locale } },
          })
        }
        const original = damaged.fields[0]!
        damaged.fields[0] = { name: 'items', type: 'array', optional: true, fields: [caption] }
        try {
          const editable = await adapter.queries.documents.getDocumentById({
            collection_id: damagedId,
            document_id: receipt.documentId,
            locale: 'en',
            reconstruct: true,
            lenient: true,
          })
          expect(editable.restoreWarnings).toEqual(
            expect.arrayContaining([expect.stringMatching(/Invalid array index/)])
          )
          await expect(
            updateSingleton(ctx, {
              expectedRevision: receipt.revision,
              locale: 'en',
              data: { items: [{ caption: 'Replacement' }] },
            })
          ).rejects.toMatchObject({
            code: 'ERR_VALIDATION',
            message: expect.stringContaining('Ask a developer'),
            details: { reason: 'stored_content_requires_repair' },
          })
          expect(
            await adapter.queries.documents.getDocumentRevision({
              collection_id: damagedId,
              document_id: receipt.documentId,
            })
          ).toBe(receipt.revision)
        } finally {
          damaged.fields[0] = original
        }
        // Restoring the old declaration proves rejection preserved the original
        // version and every locale's otherwise unreadable rows.
        const after = await adapter.queries.documents.getDocumentById({
          collection_id: damagedId,
          document_id: receipt.documentId,
          locale: 'all',
          reconstruct: true,
        })
        expect(after.document_version_id).toBe(receipt.documentVersionId)
        expect(after.fields.items.caption).toEqual(
          Object.fromEntries(locales.map((locale) => [locale, locale]))
        )
      })
    }

    it('singleton structural saves preserve the other locale', async () => {
      const first = await updateSingleton(context(true), {
        expectedState: 'empty',
        locale: 'en',
        data: { items: [{ caption: 'A' }, { caption: 'B' }] },
      })
      const french = (await read(first.documentId, 'en', true)).fields
      french.items[0].caption = 'A-fr'
      french.items[1].caption = 'B-fr'
      const second = await updateSingleton(context(true), {
        expectedRevision: first.revision,
        locale: 'fr',
        data: french,
      })
      const english = (await read(first.documentId, 'en', true)).fields
      english.items.shift()
      await updateSingleton(context(true), {
        expectedRevision: second.revision,
        locale: 'en',
        data: english,
      })
      expect(
        (await read(first.documentId, 'fr', true)).fields.items.map((item: any) => item.caption)
      ).toEqual(['B-fr'])
    })
  })
}
