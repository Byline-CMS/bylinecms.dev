/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type {
  ArrayField,
  BlocksField,
  BylineLogger,
  CollectionDefinition,
  IDbAdapter,
  LocaleVisibility,
  MissingLocalePolicy,
  MultiCollectionDefinition,
} from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import { type DocumentLifecycleContext, updateDocument } from '@byline/core/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

export function localizedToggleSuite(hooks: ConformanceHooks) {
  describe('Localized toggle', () => {
    const caption = { name: 'caption', type: 'text' as const, localized: true }
    const items: ArrayField = { name: 'items', type: 'array', fields: [caption] }
    const definition: MultiCollectionDefinition = {
      path: 'localized-toggle',
      labels: { singular: 'Toggle', plural: 'Toggles' },
      fields: [items],
    }
    const logger = Object.fromEntries(
      ['log', 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((key) => [
        key,
        vi.fn(),
      ])
    ) as unknown as BylineLogger
    let adapter: IDbAdapter
    let collectionId: string
    const context = (): DocumentLifecycleContext => ({
      db: adapter,
      definition,
      collectionPath: definition.path,
      collectionId,
      collectionVersion: 1,
      defaultLocale: 'en',
      logger,
      requestContext: createSuperAdminContext(),
    })
    const read = (id: string, locale: string, lenient = false) =>
      adapter.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: id,
        locale,
        reconstruct: true,
        lenient,
        localeVisibility: 'public',
      })
    const revision = (id: string) =>
      adapter.queries.documents.getDocumentRevision({
        collection_id: collectionId,
        document_id: id,
      })

    // Toggled collections. Each test owns its collection and toggles a field by
    // mutating the shared field object between its writes and its reads. The
    // adapter resolves definitions by reference (`collections.find` on the
    // array passed to `createAdapter`), so it sees the mutated flag without
    // being recreated.
    const text = (name: string, localized: boolean) => ({
      name,
      type: 'text' as const,
      localized: localized as boolean,
      optional: true,
    })
    const collection = (
      name: string,
      fields: CollectionDefinition['fields']
    ): MultiCollectionDefinition => ({
      path: `localized-toggle-${name}`,
      labels: { singular: name, plural: name },
      fields,
    })

    const summary1 = text('summary', false)
    const caseOne = collection('one', [summary1])

    const title2 = text('title', true)
    const summary2 = text('summary', false)
    const caseTwo = collection('two', [title2, summary2])

    const title6 = text('title', true)
    const caseSix = collection('six', [title6])

    const itemCaption = text('caption', false)
    const itemLabel = text('label', true)
    const noteCaption = text('caption', false)
    const noteLabel = text('label', true)
    const nestedItems: ArrayField = {
      name: 'items',
      type: 'array',
      optional: true,
      fields: [itemCaption, itemLabel],
    }
    const nestedContent: BlocksField = {
      name: 'content',
      type: 'blocks',
      optional: true,
      blocks: [{ blockType: 'note', fields: [noteCaption, noteLabel] }],
    }
    const caseTen = collection('ten', [nestedItems, nestedContent])

    const caseEleven = collection('eleven', [
      { name: 'items', type: 'group', optional: true, fields: [text('caption', false)] },
      text('meta', false),
    ])

    const title12 = text('title', true)
    const sku12 = text('sku', true)
    const code12 = text('code', false)
    const caseTwelve = collection('twelve', [title12, sku12, code12])

    const title14 = text('title', true)
    const code14 = text('code', false)
    const views14 = { name: 'views', type: 'integer' as const, optional: true }
    const caseFourteen = collection('fourteen', [title14, code14, views14])

    const ledgerCase = collection('ledger', [text('title', true), text('alt', false)])

    const code14b = text('code', false)
    const caseLedgerProjection = collection('ledger-projection', [
      { name: 'body', type: 'richText', localized: true, optional: true },
      code14b,
    ])

    const toggled = [
      caseOne,
      caseTwo,
      caseSix,
      caseTen,
      caseEleven,
      caseTwelve,
      caseFourteen,
      caseLedgerProjection,
      ledgerCase,
    ]
    const ids: Record<string, string> = {}
    const loggerKey = Symbol.for('__byline_logger__')
    const globals = globalThis as Record<symbol, unknown>
    let previousLogger: unknown
    let seq = 0

    async function write(def: CollectionDefinition, documentData: Record<string, unknown>) {
      seq += 1
      const path = `localized-toggle-${seq}`
      const saved = await adapter.commands.documents.createDocumentVersion({
        collectionId: ids[def.path]!,
        collectionVersion: 1,
        collectionConfig: def,
        action: 'create',
        documentData,
        path,
        locale: 'all',
        status: 'published',
      })
      return { id: saved.document.document_id, versionId: saved.document.id, path }
    }

    type Doc = Awaited<ReturnType<typeof write>>

    const byId = (
      def: CollectionDefinition,
      doc: Doc,
      locale: string,
      options: {
        lenient?: boolean
        onMissingLocale?: MissingLocalePolicy
        localeVisibility?: LocaleVisibility
      } = {}
    ) =>
      adapter.queries.documents.getDocumentById({
        collection_id: ids[def.path]!,
        document_id: doc.id,
        locale,
        reconstruct: true,
        ...options,
      })

    const listed = async (
      def: CollectionDefinition,
      doc: Doc,
      locale: string,
      options: {
        fields?: string[]
        onMissingLocale?: MissingLocalePolicy
        localeVisibility?: LocaleVisibility
      } = {}
    ) => {
      const { documents } = await adapter.queries.documents.findDocuments({
        collection_id: ids[def.path]!,
        locale,
        ...options,
      })
      return documents.find((d: any) => d.document_id === doc.id)
    }

    /** Every strict read path the spec names for cases 1 and 6, keyed by name. */
    async function readEverywhere(def: CollectionDefinition, doc: Doc, locale: string) {
      const queries = adapter.queries.documents
      const collection_id = ids[def.path]!
      return {
        id: await byId(def, doc, locale),
        path: await queries.getDocumentByPath({
          collection_id,
          path: doc.path,
          locale,
          reconstruct: true,
        }),
        version: await queries.getDocumentByVersion({
          document_version_id: doc.versionId,
          locale,
        }),
        list: await listed(def, doc, locale),
        ids: (
          await queries.getDocumentsByDocumentIds({
            collection_id,
            document_ids: [doc.id],
            locale,
          })
        )[0],
      }
    }

    /** A lenient read surfaces restore warnings instead of throwing. */
    async function expectNoWarnings(def: CollectionDefinition, doc: Doc, locale: string) {
      const lenient = await byId(def, doc, locale, { lenient: true })
      expect(lenient.restoreWarnings).toBeUndefined()
    }

    beforeAll(async () => {
      await hooks.truncate()
      previousLogger = globals[loggerKey]
      defineLogger(logger)
      adapter = await hooks.createAdapter([definition, ...toggled])
      collectionId = (await adapter.commands.collections.create(definition.path, definition))[0]!.id
      for (const def of toggled) {
        ids[def.path] = (await adapter.commands.collections.create(def.path, def))[0]!.id
      }
    })
    afterAll(() => {
      if (previousLogger === undefined) delete globals[loggerKey]
      else globals[loggerKey] = previousLogger
    })

    // Pre-existing bug (not caused by the localized toggle): a single-locale save that
    // removes an array item carries the other locales' rows forward by position, so the
    // removed item's fr translation ('A-fr') attaches to the surviving item B.
    // Issue: pending (to be filed by the maintainer)
    it.fails('positional copy-forward misattributes translations after an item removal (pre-existing)', async () => {
      const saved = await adapter.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        action: 'create',
        documentData: {
          items: [{ caption: { en: 'A', fr: 'A-fr' } }, { caption: { en: 'B', fr: 'B-fr' } }],
        },
        locale: 'all',
        status: 'published',
      })
      const id = saved.document.document_id
      const before = await read(id, 'en')
      const itemB = before.fields.items[1]
      await updateDocument(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        data: { items: [itemB] },
      })
      const after = await read(id, 'all', true)
      expect(after.fields.items).toHaveLength(1)
      expect(after.fields.items[0].caption).toEqual({ en: 'B', fr: 'B-fr' })
    })
    it('case 1: non-localized to localized, document with no other localized fields: list, path, version and id reads succeed with no warnings and return the shared value in every requested locale', async () => {
      const doc = await write(caseOne, { summary: 'Shared' })
      summary1.localized = true

      for (const locale of ['en', 'fr']) {
        const reads = await readEverywhere(caseOne, doc, locale)
        for (const [name, read] of Object.entries(reads)) {
          expect({ name, locale, summary: read?.fields.summary }).toEqual({
            name,
            locale,
            summary: 'Shared',
          })
        }
        await expectNoWarnings(caseOne, doc, locale)
      }
    })

    describe('non-localized to localized, document with a localized title complete in en and fr', () => {
      let doc: Doc
      beforeAll(async () => {
        doc = await write(caseTwo, {
          title: { en: 'Title EN', fr: 'Titre FR' },
          summary: 'Shared',
        })
        summary2.localized = true
      })

      it('case 2: fr reads (exact and fallback, editorial and public) return the French title and the shared value; resolvedLocale is fr', async () => {
        for (const onMissingLocale of [undefined, 'fallback'] as const) {
          for (const localeVisibility of ['editorial', 'public'] as const) {
            const options = { onMissingLocale, localeVisibility }
            for (const read of [
              await byId(caseTwo, doc, 'fr', options),
              await listed(caseTwo, doc, 'fr', options),
            ]) {
              expect({ options, fields: read.fields, resolved: read.resolved_locale }).toEqual({
                options,
                fields: { title: 'Titre FR', summary: 'Shared' },
                resolved: 'fr',
              })
            }
          }
        }
        await expectNoWarnings(caseTwo, doc, 'fr')
      })

      it("case 5: map-shaped read (locale: 'all') of case 2 before any save: the field's map holds the shared value under en and fr", async () => {
        for (const read of [await byId(caseTwo, doc, 'all'), await listed(caseTwo, doc, 'all')]) {
          expect(read.fields.summary).toEqual({ en: 'Shared', fr: 'Shared' })
          expect(read.fields.title).toEqual({ en: 'Title EN', fr: 'Titre FR' })
        }
        await expectNoWarnings(caseTwo, doc, 'all')
      })
    })

    it('case 6: localized to non-localized, document with en, fr and de rows: reads in every locale return the en value with no warnings', async () => {
      const doc = await write(caseSix, {
        title: { en: 'Title EN', fr: 'Titre FR', de: 'Titel DE' },
      })
      title6.localized = false

      for (const locale of ['en', 'fr', 'de']) {
        const reads = await readEverywhere(caseSix, doc, locale)
        for (const [name, read] of Object.entries(reads)) {
          expect({ name, locale, title: read?.fields.title }).toEqual({
            name,
            locale,
            title: 'Title EN',
          })
        }
        await expectNoWarnings(caseSix, doc, locale)
      }
      expect((await byId(caseSix, doc, 'all')).fields.title).toBe('Title EN')
      await expectNoWarnings(caseSix, doc, 'all')
    })

    it('case 8: case 6, source-locale row missing: the field reads as absent with no warning', async () => {
      // Case 6 has already toggled `title` to shared; write under the
      // localized flag again, then toggle back.
      title6.localized = true
      const doc = await write(caseSix, { title: { fr: 'Titre FR', de: 'Titel DE' } })
      title6.localized = false

      for (const locale of ['en', 'fr', 'all']) {
        const read = await byId(caseSix, doc, locale)
        expect(read.fields.title).toBeUndefined()
        expect((await listed(caseSix, doc, locale)).fields.title).toBeUndefined()
        await expectNoWarnings(caseSix, doc, locale)
      }
    })

    it('case 10 (read half): a field nested in a blocks item and an array item, for both directions, read without warnings', async () => {
      const doc = await write(caseTen, {
        items: [{ caption: 'Item caption', label: { en: 'Item EN', fr: 'Item FR' } }],
        content: [
          { _type: 'note', caption: 'Note caption', label: { en: 'Note EN', fr: 'Note FR' } },
        ],
      })
      itemCaption.localized = true
      noteCaption.localized = true
      itemLabel.localized = false
      noteLabel.localized = false

      for (const read of [await byId(caseTen, doc, 'fr'), await listed(caseTen, doc, 'fr')]) {
        expect(read.fields.items[0]).toMatchObject({ caption: 'Item caption', label: 'Item EN' })
        expect(read.fields.content[0]).toMatchObject({
          _type: 'note',
          caption: 'Note caption',
          label: 'Note EN',
        })
      }
      const map = await byId(caseTen, doc, 'all')
      expect(map.fields.items[0]).toMatchObject({
        caption: { en: 'Item caption', fr: 'Item caption' },
        label: 'Item EN',
      })
      expect(map.fields.content[0]).toMatchObject({
        caption: { en: 'Note caption', fr: 'Note caption' },
        label: 'Note EN',
      })
      for (const locale of ['fr', 'all']) await expectNoWarnings(caseTen, doc, locale)
    })

    it('case 11: strict reads still throw on genuine reconstruction damage: an invalid array index and a truncated structural path', async () => {
      const invalidIndex = await write(caseEleven, { items: { caption: 'Grouped' } })
      const truncated = await write(caseEleven, { meta: 'Plain' })
      // `items` becomes an array (its stored `items.caption` path has no index)
      // and `meta` becomes a group (its stored `meta` path ends at the group).
      caseEleven.fields.splice(
        0,
        caseEleven.fields.length,
        { name: 'items', type: 'array', optional: true, fields: [text('caption', false)] },
        { name: 'meta', type: 'group', optional: true, fields: [text('inner', false)] }
      )

      for (const [doc, warning] of [
        [invalidIndex, /Invalid array index/],
        [truncated, /Path ended unexpectedly while restoring group/],
      ] as const) {
        await expect(byId(caseEleven, doc, 'en')).rejects.toThrow(/document reconstruction failed/)
        await expect(
          adapter.queries.documents.getDocumentByVersion({
            document_version_id: doc.versionId,
            locale: 'en',
          })
        ).rejects.toThrow(/document reconstruction failed/)
        const lenient = await byId(caseEleven, doc, 'en', { lenient: true })
        expect(lenient.restoreWarnings).toEqual(
          expect.arrayContaining([expect.stringMatching(warning)])
        )
      }
    })

    it("case 12: public exact read of an ineligible locale (4.2a): a now-shared field shows the source value; a now-localized field's shared value is withheld", async () => {
      // `fr` lacks the localized title, so it is incomplete and ineligible.
      const doc = await write(caseTwelve, {
        title: { en: 'Title EN' },
        sku: { en: 'SKU EN', fr: 'SKU FR' },
        code: 'Code',
      })
      sku12.localized = false
      code12.localized = true

      const options = { localeVisibility: 'public' as const }
      for (const read of [
        await byId(caseTwelve, doc, 'fr', options),
        await listed(caseTwelve, doc, 'fr', options),
      ]) {
        expect(read.resolved_locale).toBeNull()
        expect(read.fields.sku).toBe('SKU EN')
        expect(read.fields.code).toBeUndefined()
        expect(read.fields.title).toBeUndefined()
      }
      await expectNoWarnings(caseTwelve, doc, 'fr')
    })

    it('case 14: projected list read and a projected map-shaped read: no warnings. The projected map omits a partial locale stored only in an unselected store table; a full map read of the same version includes it', async () => {
      // A number field cannot be declared localized; seed a partial `fr`
      // numeric row by writing under an untyped localized flag.
      const seeded = views14 as { localized?: boolean }
      seeded.localized = true
      const doc = await write(caseFourteen, {
        title: { en: 'Title EN' },
        code: 'Code',
        views: { en: 1, fr: 2 },
      })
      delete seeded.localized
      code14.localized = true

      const projected = ['title', 'code']
      for (const locale of ['en', 'fr']) {
        const read = await listed(caseFourteen, doc, locale, { fields: projected })
        expect(read.fields.code).toBe('Code')
      }
      const projectedMap = await listed(caseFourteen, doc, 'all', { fields: projected })
      expect(projectedMap.fields.code).toEqual({ en: 'Code' })

      for (const full of [
        await listed(caseFourteen, doc, 'all'),
        await byId(caseFourteen, doc, 'all'),
      ]) {
        expect(full.fields.code).toEqual({ en: 'Code', fr: 'Code' })
        expect(full.fields.views).toBe(1)
      }
      await expectNoWarnings(caseFourteen, doc, 'all')
    })

    it("decision 7: a projected map-shaped read reports a now-localized field's shared value under every ledger locale, including one its loaded rows lack", async () => {
      // The localized body lives in the JSON store and is complete in en and
      // fr, so the ledger lists both. Projecting only `code` loads the text
      // store, which holds just code's shared row: no loaded row shows fr.
      const richText = (value: string) => ({
        root: { type: 'root', children: [{ type: 'text', text: value }] },
      })
      const doc = await write(caseLedgerProjection, {
        body: { en: richText('Body EN'), fr: richText('Corps FR') },
        code: 'Code',
      })
      code14b.localized = true
      const ledger = (await byId(caseLedgerProjection, doc, 'en'))._availableVersionLocales
      expect(ledger).toEqual(expect.arrayContaining(['en', 'fr']))

      const projectedMap = await listed(caseLedgerProjection, doc, 'all', { fields: ['code'] })
      expect(projectedMap.fields.code).toEqual({ en: 'Code', fr: 'Code' })
      expect(projectedMap.fields.body).toBeUndefined()
    })

    it('listVersionFieldLocales returns the distinct (field_path, locale) pairs of a version', async () => {
      const doc = await write(ledgerCase, { title: { en: 'Title EN', fr: 'Titre FR' }, alt: 'Alt' })
      const pairs = await adapter.queries.documents.listVersionFieldLocales({
        document_version_id: doc.versionId,
      })
      const key = (p: { field_path: string; locale: string }) => `${p.field_path}:${p.locale}`
      expect(pairs.map(key).sort()).toEqual(['alt:all', 'title:en', 'title:fr'])
    })
  })
}
