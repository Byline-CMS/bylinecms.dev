/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import {
  type ArrayField,
  type BlocksField,
  type BylineLogger,
  type CollectionDefinition,
  type DocumentFilter,
  type FieldFilter,
  type FieldSort,
  type IDbAdapter,
  type LocaleVisibility,
  type MissingLocalePolicy,
  type MultiCollectionDefinition,
  parseSort,
  parseWhere,
  type QueryPredicate,
  type SingletonDefinition,
  type SortSpec,
} from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import {
  copySingletonToLocale,
  copyToLocale,
  type DocumentLifecycleContext,
  updateDocument,
  updateDocumentWithPatches,
  updateSingleton,
} from '@byline/core/services'
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

    // Filter and sort collections (spec 4.4). Each case owns its collection,
    // so a sort over the whole collection sees only that case's documents.
    const title9 = text('title', true)
    const caseNineShared = collection('nine-shared', [title9])
    const summary9 = text('summary', false)
    const caseNineLocalized = collection('nine-localized', [text('title', true), summary9])
    const title13 = text('title', true)
    const caseThirteen = collection('thirteen', [title13])
    const title19 = text('title', true)
    const caseNineteen = collection('nineteen', [title19])
    const summary20 = text('summary', false)
    const sku20 = text('sku', true)
    const caseTwenty = collection('twenty', [text('title', true), summary20, sku20])
    const name21 = text('name', true)
    const label21 = text('label', false)
    const caseTwentyOneTarget = collection('twenty-one-target', [
      text('title', true),
      name21,
      label21,
    ])
    const caseTwentyOne = collection('twenty-one', [
      text('title', true),
      {
        name: 'topic',
        type: 'relation',
        targetCollection: caseTwentyOneTarget.path,
        optional: true,
      },
    ])
    const caseCompatibility = collection('compatibility', [text('title', true)])
    const sourceTitle = text('title', true)
    const caseSourceLocales = collection('source-locales', [sourceTitle])
    const targetSourceTitle = text('title', true)
    const caseSourceTarget = collection('source-target', [targetSourceTitle])
    const caseSourceParent = collection('source-parent', [
      text('title', true),
      {
        name: 'topic',
        type: 'relation',
        targetCollection: caseSourceTarget.path,
        optional: true,
      },
    ])
    const filterSide = [
      caseSourceLocales,
      caseSourceTarget,
      caseSourceParent,
      caseNineShared,
      caseNineLocalized,
      caseThirteen,
      caseNineteen,
      caseTwenty,
      caseTwentyOneTarget,
      caseTwentyOne,
      caseCompatibility,
    ]

    // Save-side collections (spec 4.3). Each test or describe owns its
    // collection, so a toggle never leaks into another case.
    const titled = (name: string, extra: CollectionDefinition['fields']) =>
      collection(name, [text('title', true), ...extra])
    const summary3 = text('summary', false)
    const caseThree = titled('three', [summary3])
    const summary4 = text('summary', false)
    const caseFour = titled('four', [summary4])
    const summaryPatch = text('summary', false)
    const casePatch = titled('patch', [summaryPatch])
    const bodyRich = { name: 'body', type: 'richText' as const, optional: true, localized: false }
    const caseRichText = titled('rich-text', [bodyRich])
    const viewsNumber = { name: 'views', type: 'integer' as const, optional: true }
    const caseNumber = titled('number', [viewsNumber])
    const title7 = text('title', true)
    const caseSeven = collection('seven', [title7])
    const saveItemCaption = text('caption', false)
    const saveItemLabel = text('label', true)
    const saveNoteCaption = text('caption', false)
    const saveNoteLabel = text('label', true)
    const caseTenSave = collection('ten-save', [
      { name: 'items', type: 'array', optional: true, fields: [saveItemCaption, saveItemLabel] },
      {
        name: 'content',
        type: 'blocks',
        optional: true,
        blocks: [{ blockType: 'note', fields: [saveNoteCaption, saveNoteLabel] }],
      },
    ])
    const liveText15 = text('text', false)
    const live15 = { blockType: 'live', fields: [liveText15] }
    const retired15 = { blockType: 'retired', fields: [text('text', false)] }
    const content15: BlocksField = {
      name: 'content',
      type: 'blocks',
      optional: true,
      blocks: [live15, retired15],
    }
    const caseFifteen = titled('fifteen', [content15])
    /** An array item's field, a group-nested array item's field and a block item's field. */
    const structured = (name: string, localized: boolean) => {
      const itemCaption = text('caption', localized)
      const metaNote = text('note', localized)
      const blockCaption = text('caption', localized)
      return {
        def: titled(name, [
          {
            name: 'items',
            type: 'array',
            optional: true,
            fields: [
              itemCaption,
              { name: 'meta', type: 'group', optional: true, fields: [metaNote] },
            ],
          },
          {
            name: 'content',
            type: 'blocks',
            optional: true,
            blocks: [{ blockType: 'note', fields: [blockCaption] }],
          },
        ]),
        toggle: () => {
          for (const field of [itemCaption, metaNote, blockCaption]) field.localized = !localized
        },
      }
    }
    const caseSixteen = structured('sixteen', false)
    const caseSeventeen = structured('seventeen', true)
    const caseTwentyFour = structured('twenty-four', false)
    const summary18 = text('summary', false)
    const caseEighteen = titled('eighteen', [summary18])
    const title22 = text('title', true)
    const caseTwentyTwo = collection('twenty-two', [title22])
    const note23 = text('note', true)
    const caseTwentyThree = titled('twenty-three', [note23])
    const summaryCopy = text('summary', false)
    const caseCopyToggled = titled('copy-toggled', [summaryCopy])
    const caseCopyClean = titled('copy-clean', [text('summary', true)])
    const singleton = (
      name: string,
      fields: CollectionDefinition['fields']
    ): SingletonDefinition => ({
      path: `localized-toggle-singleton-${name}`,
      singleton: true,
      label: name,
      fields: [text('title', true), ...fields],
    })
    const summarySingleton = text('summary', false)
    const singletonSave = singleton('save', [summarySingleton])
    const summarySingletonCopy = text('summary', false)
    const singletonCopyToggled = singleton('copy-toggled', [summarySingletonCopy])
    const singletonCopyClean = singleton('copy-clean', [text('summary', true)])
    const summarySoloClean = text('summary', false)
    const caseSoloClean = titled('solo-clean', [summarySoloClean])
    const summarySoloToggled = text('summary', false)
    const caseSoloToggled = titled('solo-toggled', [summarySoloToggled])
    const summarySoloCopy = text('summary', false)
    const caseSoloCopy = titled('solo-copy', [summarySoloCopy])
    const soloSide = [caseSoloClean, caseSoloToggled, caseSoloCopy]
    const saveSide = [
      ...soloSide,
      caseThree,
      caseFour,
      casePatch,
      caseRichText,
      caseNumber,
      caseSeven,
      caseTenSave,
      caseFifteen,
      caseSixteen.def,
      caseSeventeen.def,
      caseTwentyFour.def,
      caseEighteen,
      caseTwentyTwo,
      caseTwentyThree,
      caseCopyToggled,
      caseCopyClean,
      singletonSave,
      singletonCopyToggled,
      singletonCopyClean,
    ]

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
      ...filterSide,
      ...saveSide,
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

    const lifecycle = (def: CollectionDefinition, db = adapter): DocumentLifecycleContext => ({
      db,
      definition: def,
      collectionPath: def.path,
      collectionId: ids[def.path]!,
      collectionVersion: 1,
      defaultLocale: 'en',
      logger,
      requestContext: createSuperAdminContext(),
    })
    const revisionOf = async (def: CollectionDefinition, documentId: string) =>
      (await adapter.queries.documents.getDocumentRevision({
        collection_id: ids[def.path]!,
        document_id: documentId,
      }))!
    /** The current version's id, read leniently so a damaged version still answers. */
    const currentVersionId = async (def: CollectionDefinition, documentId: string) =>
      (await byId(def, { id: documentId } as Doc, 'en', { lenient: true }))
        .document_version_id as string
    /** The current version's stored `field_path:locale` pairs, sorted. */
    async function storedPairs(def: CollectionDefinition, documentId: string) {
      const pairs = await adapter.queries.documents.listVersionFieldLocales({
        document_version_id: await currentVersionId(def, documentId),
      })
      return pairs.map((p) => `${p.field_path}:${p.locale}`).sort()
    }
    /** Single-locale lifecycle save of `data`, which replaces that locale's view. */
    async function save(
      def: CollectionDefinition,
      doc: Pick<Doc, 'id'>,
      locale: string,
      data: Record<string, any>
    ) {
      return updateDocument(lifecycle(def), {
        documentId: doc.id,
        expectedRevision: await revisionOf(def, doc.id),
        locale,
        data,
      })
    }
    const fieldsOf = async (def: CollectionDefinition, doc: Pick<Doc, 'id'>, locale: string) =>
      structuredClone((await byId(def, doc as Doc, locale)).fields) as Record<string, any>

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

    // --- Saving (spec 4.3) -------------------------------------------------

    it('case 3: case 2, then save in en with a new en value: the fr read returns the old shared value, the ledger still lists fr, and the version has no shared row for the field', async () => {
      const doc = await write(caseThree, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        summary: 'Shared',
      })
      summary3.localized = true

      await save(caseThree, doc, 'en', {
        ...(await fieldsOf(caseThree, doc, 'en')),
        summary: 'New EN',
      })

      const fr = await byId(caseThree, doc, 'fr')
      expect(fr.fields.summary).toBe('Shared')
      expect(fr._availableVersionLocales).toEqual(expect.arrayContaining(['en', 'fr']))
      expect((await byId(caseThree, doc, 'en')).fields.summary).toBe('New EN')
      const pairs = await storedPairs(caseThree, doc.id)
      expect(pairs).not.toContain('summary:all')
      expect(pairs).toEqual(expect.arrayContaining(['summary:en', 'summary:fr']))
    })

    it('case 4: case 2, then save in fr (the non-source locale): the en read returns the old shared value. This is the data-loss regression', async () => {
      const doc = await write(caseFour, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        summary: 'Shared',
      })
      summary4.localized = true

      await save(caseFour, doc, 'fr', {
        ...(await fieldsOf(caseFour, doc, 'fr')),
        summary: 'Résumé FR',
      })

      expect((await byId(caseFour, doc, 'en')).fields).toEqual({
        title: 'Title EN',
        summary: 'Shared',
      })
      expect((await byId(caseFour, doc, 'fr')).fields.summary).toBe('Résumé FR')
      expect(await storedPairs(caseFour, doc.id)).not.toContain('summary:all')
    })

    it('review focus 1: case 4 through updateDocumentWithPatches: the en read returns the old shared value', async () => {
      const doc = await write(casePatch, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        summary: 'Shared',
      })
      summaryPatch.localized = true

      await updateDocumentWithPatches(lifecycle(casePatch), {
        documentId: doc.id,
        expectedRevision: await revisionOf(casePatch, doc.id),
        locale: 'fr',
        patches: [{ kind: 'field.set', path: 'summary', value: 'Résumé FR' }],
      })

      expect((await byId(casePatch, doc, 'en')).fields.summary).toBe('Shared')
      expect((await byId(casePatch, doc, 'fr')).fields.summary).toBe('Résumé FR')
      expect(await storedPairs(casePatch, doc.id)).not.toContain('summary:all')
    })

    it('review focus 2: case 4 through updateSingleton: the en read returns the old shared value', async () => {
      const ctx = lifecycle(singletonSave)
      const first = await updateSingleton(ctx, {
        expectedState: 'empty',
        data: { title: 'Title EN', summary: 'Shared' },
        locale: 'en',
      })
      const second = await updateSingleton(ctx, {
        expectedRevision: first.revision,
        data: { title: 'Titre FR', summary: 'Shared' },
        locale: 'fr',
      })
      summarySingleton.localized = true

      const doc = { id: first.documentId }
      await updateSingleton(ctx, {
        expectedRevision: second.revision,
        data: { ...(await fieldsOf(singletonSave, doc, 'fr')), summary: 'Résumé FR' },
        locale: 'fr',
      })

      expect((await byId(singletonSave, doc as Doc, 'en')).fields).toEqual({
        title: 'Title EN',
        summary: 'Shared',
      })
      expect((await byId(singletonSave, doc as Doc, 'fr')).fields.summary).toBe('Résumé FR')
      expect(await storedPairs(singletonSave, doc.id)).not.toContain('summary:all')
    })

    it('review focus 3: case 4 for a richText field: the en read returns the old shared value', async () => {
      const rich = (value: string) => ({
        root: { type: 'root', children: [{ type: 'text', text: value }] },
      })
      const doc = await write(caseRichText, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        body: rich('Shared body'),
      })
      bodyRich.localized = true

      await save(caseRichText, doc, 'fr', {
        ...(await fieldsOf(caseRichText, doc, 'fr')),
        body: rich('Corps FR'),
      })

      expect((await byId(caseRichText, doc, 'en')).fields.body).toEqual(rich('Shared body'))
      expect((await byId(caseRichText, doc, 'fr')).fields.body).toEqual(rich('Corps FR'))
      expect(await storedPairs(caseRichText, doc.id)).not.toContain('body:all')
    })

    it('review focus 3: a number field saved in fr after a localized-to-shared toggle: the new version has only a shared row for the field', async () => {
      // Number fields cannot be declared localized (`NonlocalizableField`), so
      // the shared-to-localized direction does not apply. Seed the numeric
      // locale rows under an untyped localized flag, then remove it.
      const seeded = viewsNumber as { localized?: boolean }
      seeded.localized = true
      const doc = await write(caseNumber, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        views: { en: 1, fr: 2 },
      })
      delete seeded.localized

      await save(caseNumber, doc, 'fr', { ...(await fieldsOf(caseNumber, doc, 'fr')), views: 5 })

      const pairs = await storedPairs(caseNumber, doc.id)
      expect(pairs.filter((pair) => pair.startsWith('views:'))).toEqual(['views:all'])
      for (const locale of ['en', 'fr']) {
        expect((await byId(caseNumber, doc, locale)).fields.views).toBe(5)
      }
    })

    it('case 7: case 6, then save in fr: the new version has only a shared row for the field, and the next read succeeds', async () => {
      const doc = await write(caseSeven, {
        title: { en: 'Title EN', fr: 'Titre FR', de: 'Titel DE' },
      })
      title7.localized = false

      await save(caseSeven, doc, 'fr', { title: 'Title saved in fr' })

      expect(await storedPairs(caseSeven, doc.id)).toEqual(['title:all'])
      for (const locale of ['en', 'fr', 'de']) {
        const reads = await readEverywhere(caseSeven, doc, locale)
        for (const [name, read] of Object.entries(reads)) {
          if (name === 'version') continue // `doc.versionId` is the pre-save version
          expect({ name, locale, title: read?.fields.title }).toEqual({
            name,
            locale,
            title: 'Title saved in fr',
          })
        }
        await expectNoWarnings(caseSeven, doc, locale)
      }
    })

    it('case 10 (save half): a field nested in a blocks item and an array item, for both directions, saved without structural changes', async () => {
      const doc = await write(caseTenSave, {
        items: [{ caption: 'Item caption', label: { en: 'Item EN', fr: 'Item FR' } }],
        content: [
          { _type: 'note', caption: 'Note caption', label: { en: 'Note EN', fr: 'Note FR' } },
        ],
      })
      saveItemCaption.localized = true
      saveNoteCaption.localized = true
      saveItemLabel.localized = false
      saveNoteLabel.localized = false

      const fr = await fieldsOf(caseTenSave, doc, 'fr')
      fr.items[0].caption = 'Item caption FR'
      fr.content[0].caption = 'Note caption FR'
      await save(caseTenSave, doc, 'fr', fr)

      const map = await byId(caseTenSave, doc, 'all')
      expect(map.fields.items[0]).toMatchObject({
        caption: { en: 'Item caption', fr: 'Item caption FR' },
        label: 'Item EN',
      })
      expect(map.fields.content[0]).toMatchObject({
        _type: 'note',
        caption: { en: 'Note caption', fr: 'Note caption FR' },
        label: 'Note EN',
      })
      expect(await storedPairs(caseTenSave, doc.id)).toEqual(
        [
          'content.0.note.caption:en',
          'content.0.note.caption:fr',
          'content.0.note.label:all',
          'items.0.caption:en',
          'items.0.caption:fr',
          'items.0.label:all',
        ].sort()
      )
      for (const locale of ['en', 'fr', 'all']) await expectNoWarnings(caseTenSave, doc, locale)
    })

    it('case 15: a save of a document with an unavailable block after a non-localized-to-localized toggle: the other locales keep the shared value', async () => {
      const doc = await write(caseFifteen, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        content: [
          { _type: 'retired', text: 'retired-0' },
          { _type: 'live', text: 'live-1' },
          { _type: 'live', text: 'live-2' },
        ],
      })
      content15.blocks = [live15]
      liveText15.localized = true

      const fr = await fieldsOf(caseFifteen, doc, 'fr')
      fr.content[0].text = 'live-1 FR'
      await save(caseFifteen, doc, 'fr', fr)

      const en = await byId(caseFifteen, doc, 'en')
      expect(en.fields.content.map((item: any) => item.text)).toEqual(['live-1', 'live-2'])
      expect(en.unavailableBlocks).toBeUndefined()
      const frRead = await byId(caseFifteen, doc, 'fr')
      expect(frRead.fields.content.map((item: any) => item.text)).toEqual(['live-1 FR', 'live-2'])
      expect((await storedPairs(caseFifteen, doc.id)).filter((p) => p.endsWith(':all'))).toEqual([])
    })

    /**
     * Two-item documents (items A and B in an array, a group inside each array
     * item, and a blocks field) for the removal and reorder cases. `setup`
     * writes one document per name and then toggles the fields; `saveFr`
     * saves `fr` with the named items in the given order and returns the map
     * read of the result.
     */
    function structuralCases(
      shape: ReturnType<typeof structured>,
      seedValue: (letter: string) => unknown
    ) {
      const docs: Record<string, Doc> = {}
      const seed = () => ({
        title: { en: 'Title EN', fr: 'Titre FR' },
        items: ['A', 'B'].map((letter) => ({
          caption: seedValue(letter),
          meta: { note: seedValue(`${letter}-note`) },
        })),
        content: ['A', 'B'].map((letter) => ({ _type: 'note', caption: seedValue(letter) })),
      })
      return {
        docs,
        async setup(names: string[]) {
          for (const name of names) docs[name] = await write(shape.def, seed())
          shape.toggle()
        },
        async saveFr(
          name: string,
          letters: string[],
          frValue: (letter: string) => string,
          keepIds = true
        ) {
          const fr = await fieldsOf(shape.def, docs[name]!, 'fr')
          const pick = (list: any[], indexOf: (letter: string) => number) =>
            letters.map((letter) => {
              const item = { ...list[indexOf(letter)] }
              if (!keepIds) delete item._id
              return item
            })
          const at = (letter: string) => (letter === 'A' ? 0 : 1)
          fr.items = pick(fr.items, at).map((item, i) => ({
            ...item,
            caption: frValue(letters[i]!),
            meta: { ...item.meta, note: frValue(`${letters[i]}-note`) },
          }))
          fr.content = pick(fr.content, at).map((item, i) => ({
            ...item,
            caption: frValue(letters[i]!),
          }))
          await save(shape.def, docs[name]!, 'fr', fr)
          return byId(shape.def, docs[name]!, 'all')
        },
      }
    }

    describe('case 16: first save after a non-localized-to-localized toggle of an array item, a group-nested array item and a block item field, saved in the non-source locale', () => {
      const cases = structuralCases(caseSixteen, (letter) => letter)
      beforeAll(() => cases.setup(['remove', 'reorder']))

      it('removing the first item leaves the survivor with its own value in every locale and no row at the removed position (review focus 5: items.N.meta.note)', async () => {
        const map = await cases.saveFr('remove', ['B'], (l) => `${l} FR`)
        expect(map.fields.items).toHaveLength(1)
        expect(map.fields.items[0].caption).toEqual({ en: 'B', fr: 'B FR' })
        expect(map.fields.items[0].meta.note).toEqual({ en: 'B-note', fr: 'B-note FR' })
        expect(map.fields.content).toHaveLength(1)
        expect(map.fields.content[0].caption).toEqual({ en: 'B', fr: 'B FR' })
        const pairs = await storedPairs(caseSixteen.def, cases.docs.remove!.id)
        expect(pairs.filter((p) => /^(items|content)\.1\./.test(p))).toEqual([])
        expect(pairs.filter((p) => p.endsWith(':all'))).toEqual([])
      })

      it('reordering items keeps each item value attached to that item (review focus 5: items.N.meta.note)', async () => {
        const before = await byId(caseSixteen.def, cases.docs.reorder!, 'all')
        const map = await cases.saveFr('reorder', ['B', 'A'], (l) => `${l} FR`)
        expect(map.fields.items.map((item: any) => item._id)).toEqual(
          [...before.fields.items].reverse().map((item: any) => item._id)
        )
        expect(map.fields.items.map((item: any) => item.caption)).toEqual([
          { en: 'B', fr: 'B FR' },
          { en: 'A', fr: 'A FR' },
        ])
        expect(map.fields.items.map((item: any) => item.meta.note)).toEqual([
          { en: 'B-note', fr: 'B-note FR' },
          { en: 'A-note', fr: 'A-note FR' },
        ])
        expect(map.fields.content.map((item: any) => item.caption)).toEqual([
          { en: 'B', fr: 'B FR' },
          { en: 'A', fr: 'A FR' },
        ])
        const pairs = await storedPairs(caseSixteen.def, cases.docs.reorder!.id)
        expect(pairs.filter((p) => p.endsWith(':all'))).toEqual([])
      })
    })

    describe('case 17: the same removal and reorder cases after a localized-to-shared toggle', () => {
      const cases = structuralCases(caseSeventeen, (letter) => ({
        en: letter,
        fr: `${letter}-fr`,
        de: `${letter}-de`,
      }))
      beforeAll(() => cases.setup(['remove', 'reorder']))

      it('removing the first item leaves the survivor with its own value and no row at the removed position', async () => {
        const map = await cases.saveFr('remove', ['B'], (l) => `${l} saved`)
        expect(map.fields.items).toHaveLength(1)
        expect(map.fields.items[0].caption).toBe('B saved')
        expect(map.fields.items[0].meta.note).toBe('B-note saved')
        expect(map.fields.content).toHaveLength(1)
        expect(map.fields.content[0].caption).toBe('B saved')
        // Only shared rows remain for the now-shared fields: no stale en/de
        // rows carried forward, and nothing at the removed position.
        expect(await storedPairs(caseSeventeen.def, cases.docs.remove!.id)).toEqual(
          [
            'content.0.note.caption:all',
            'items.0.caption:all',
            'items.0.meta.note:all',
            'title:en',
            'title:fr',
          ].sort()
        )
      })

      it('reordering items keeps each item value attached to that item', async () => {
        const map = await cases.saveFr('reorder', ['B', 'A'], (l) => `${l} saved`)
        expect(map.fields.items.map((item: any) => item.caption)).toEqual(['B saved', 'A saved'])
        expect(map.fields.items.map((item: any) => item.meta.note)).toEqual([
          'B-note saved',
          'A-note saved',
        ])
        expect(map.fields.content.map((item: any) => item.caption)).toEqual(['B saved', 'A saved'])
        const pairs = await storedPairs(caseSeventeen.def, cases.docs.reorder!.id)
        expect(pairs.filter((p) => /^(items|content)\./.test(p) && !p.endsWith(':all'))).toEqual([])
      })
    })

    it('case 18: a save of a document with no mismatch takes the ordinary copy-forward path (no merged write)', async () => {
      // No toggle: summary stays shared, title stays localized.
      const doc = await write(caseEighteen, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        summary: 'Shared',
      })
      const queries = adapter.queries.documents
      const listSpy = vi.spyOn(queries, 'listVersionFieldLocales')
      const versionSpy = vi.spyOn(queries, 'getDocumentByVersion')
      try {
        await save(caseEighteen, doc, 'fr', {
          ...(await fieldsOf(caseEighteen, doc, 'fr')),
          title: 'Titre FR 2',
        })
        // The check ran, found nothing, and no merged write's map read followed.
        expect(listSpy).toHaveBeenCalledWith({ document_version_id: doc.versionId })
        expect(versionSpy).not.toHaveBeenCalledWith(expect.objectContaining({ locale: 'all' }))
      } finally {
        listSpy.mockRestore()
        versionSpy.mockRestore()
      }
      expect((await byId(caseEighteen, doc, 'en')).fields).toEqual({
        title: 'Title EN',
        summary: 'Shared',
      })
      expect((await byId(caseEighteen, doc, 'fr')).fields.title).toBe('Titre FR 2')
    })

    it('case 22: a version written before this fix with mixed rows and the current collection_version: a lifecycle save takes the merged-write path and leaves no stale rows', async () => {
      const doc = await write(caseTwentyTwo, { title: { en: 'Title EN', fr: 'Titre FR' } })
      title22.localized = false
      // Reproduce a save made before this fix, after the toggle: a single-locale
      // write under the current definition and the context's collection version.
      // Copy-forward carries the stale `en` row next to the new shared row.
      const ctx = lifecycle(caseTwentyTwo)
      await adapter.commands.documents.createDocumentVersion({
        collectionId: ctx.collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: caseTwentyTwo,
        action: 'update',
        documentId: doc.id,
        documentData: { title: 'Shared FR' },
        locale: 'fr',
        previousVersionId: doc.versionId,
        status: 'published',
      })
      expect(await storedPairs(caseTwentyTwo, doc.id)).toEqual(['title:all', 'title:en'])

      // Save in a locale other than the stale row's, so ordinary copy-forward
      // would carry the stale `en` row into the new version.
      await save(caseTwentyTwo, doc, 'fr', { title: 'Saved FR' })

      expect(await storedPairs(caseTwentyTwo, doc.id)).toEqual(['title:all'])
      expect((await byId(caseTwentyTwo, doc, 'en')).fields.title).toBe('Saved FR')
    })

    it('case 23: a now-shared optional field with only a fr row, saved in en through the update lifecycle: the new version has no fr row for the field', async () => {
      const doc = await write(caseTwentyThree, {
        title: { en: 'Title EN', fr: 'Titre FR' },
        note: { fr: 'Note FR' },
      })
      note23.localized = false

      const en = await fieldsOf(caseTwentyThree, doc, 'en')
      expect(en.note).toBeUndefined()
      await save(caseTwentyThree, doc, 'en', en)

      const pairs = await storedPairs(caseTwentyThree, doc.id)
      expect(pairs.filter((p) => p.startsWith('note:'))).toEqual([])
      expect(pairs).toEqual(['title:en', 'title:fr'])
    })

    describe('case 24: removal and reorder with items submitted without _id', () => {
      const cases = structuralCases(caseTwentyFour, (letter) => letter)
      beforeAll(() =>
        cases.setup([
          'remove-with-id',
          'remove-without-id',
          'reorder-with-id',
          'reorder-without-id',
        ])
      )

      it('with _id, items are matched by identity', async () => {
        const removed = await cases.saveFr('remove-with-id', ['B'], (l) => `${l} FR`)
        expect(removed.fields.items.map((item: any) => item.caption)).toEqual([
          { en: 'B', fr: 'B FR' },
        ])
        const reordered = await cases.saveFr('reorder-with-id', ['B', 'A'], (l) => `${l} FR`)
        expect(reordered.fields.items.map((item: any) => item.caption)).toEqual([
          { en: 'B', fr: 'B FR' },
          { en: 'A', fr: 'A FR' },
        ])
      })

      it('without _id, items are matched by position, as documented', async () => {
        // Decision 14: a single-locale payload without item `_id`s is matched by
        // position, so B's fr value pairs with the value A held at index 0 in
        // the other locales. This is the documented limitation, not a defect.
        const removed = await cases.saveFr('remove-without-id', ['B'], (l) => `${l} FR`, false)
        expect(removed.fields.items.map((item: any) => item.caption)).toEqual([
          { en: 'A', fr: 'B FR' },
        ])
        expect(removed.fields.content.map((item: any) => item.caption)).toEqual([
          { en: 'A', fr: 'B FR' },
        ])
        const reordered = await cases.saveFr(
          'reorder-without-id',
          ['B', 'A'],
          (l) => `${l} FR`,
          false
        )
        expect(reordered.fields.items.map((item: any) => item.caption)).toEqual([
          { en: 'A', fr: 'B FR' },
          { en: 'B', fr: 'A FR' },
        ])
      })
    })

    describe('review focus 4: copy-to-locale whose merged values already equal the baseline', () => {
      const seed = { title: { en: 'Title EN', fr: 'Titre FR' } }

      it('after a shared-to-localized toggle, copyToLocale en to fr with overwrite false writes a new version that converts the field', async () => {
        const doc = await write(caseCopyToggled, { ...seed, summary: 'Shared' })
        summaryCopy.localized = true

        const result = await copyToLocale(lifecycle(caseCopyToggled), {
          documentId: doc.id,
          expectedRevision: await revisionOf(caseCopyToggled, doc.id),
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })

        expect(result.documentVersionId).not.toBe(doc.versionId)
        expect((await byId(caseCopyToggled, doc, 'en')).fields).toEqual({
          title: 'Title EN',
          summary: 'Shared',
        })
        expect((await byId(caseCopyToggled, doc, 'fr')).fields.summary).toBe('Shared')
        const pairs = await storedPairs(caseCopyToggled, doc.id)
        expect(pairs).not.toContain('summary:all')
        expect(pairs).toEqual(expect.arrayContaining(['summary:en', 'summary:fr']))
      })

      it('on an untoggled document with the same values, copyToLocale returns changed: false and writes no version', async () => {
        const doc = await write(caseCopyClean, { ...seed, summary: { en: 'Shared', fr: 'Shared' } })
        const before = await revisionOf(caseCopyClean, doc.id)

        const result = await copyToLocale(lifecycle(caseCopyClean), {
          documentId: doc.id,
          expectedRevision: before,
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })

        expect(result.documentVersionId).toBe(doc.versionId)
        expect(await currentVersionId(caseCopyClean, doc.id)).toBe(doc.versionId)
      })

      /** Seeds a singleton complete in en and fr whose summary reads 'Shared' in both. */
      async function seedSingleton(def: SingletonDefinition) {
        const ctx = lifecycle(def)
        const first = await updateSingleton(ctx, {
          expectedState: 'empty',
          data: { title: 'Title EN', summary: 'Shared' },
          locale: 'en',
        })
        const second = await updateSingleton(ctx, {
          expectedRevision: first.revision,
          data: { title: 'Titre FR', summary: 'Shared' },
          locale: 'fr',
        })
        return { ctx, ...second }
      }

      it('after a shared-to-localized toggle, copySingletonToLocale en to fr with overwrite false writes a new version that converts the field', async () => {
        const seeded = await seedSingleton(singletonCopyToggled)
        summarySingletonCopy.localized = true

        const result = await copySingletonToLocale(seeded.ctx, {
          expectedRevision: seeded.revision,
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })

        const doc = { id: seeded.documentId } as Doc
        expect(result.documentVersionId).not.toBe(seeded.documentVersionId)
        expect((await byId(singletonCopyToggled, doc, 'en')).fields).toEqual({
          title: 'Title EN',
          summary: 'Shared',
        })
        expect((await byId(singletonCopyToggled, doc, 'fr')).fields.summary).toBe('Shared')
        const pairs = await storedPairs(singletonCopyToggled, doc.id)
        expect(pairs).not.toContain('summary:all')
        expect(pairs).toEqual(expect.arrayContaining(['summary:en', 'summary:fr']))
      })

      it('on an untoggled singleton with the same values, copySingletonToLocale returns changed: false and writes no version', async () => {
        const seeded = await seedSingleton(singletonCopyClean)

        const result = await copySingletonToLocale(seeded.ctx, {
          expectedRevision: seeded.revision,
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })

        expect(result.documentVersionId).toBe(seeded.documentVersionId)
        expect(result.revision).toBe(seeded.revision)
        expect(await currentVersionId(singletonCopyClean, seeded.documentId)).toBe(
          seeded.documentVersionId
        )
      })
    })

    describe('filters and sorts follow the current declaration (4.4)', () => {
      const parseContext = {
        collections: toggled,
        resolveCollectionId: async (path: string) => ids[path]!,
      }
      type ReadOptions = {
        onMissingLocale?: MissingLocalePolicy
        localeVisibility?: LocaleVisibility
      }
      /** The ids of the documents a parser-generated where clause matches. */
      const matching = async (
        def: CollectionDefinition,
        where: QueryPredicate,
        locale: string,
        options: ReadOptions = {}
      ) => {
        const { filters } = await parseWhere(where, def, parseContext)
        return matchingFilters(def, filters, locale, options)
      }
      const matchingFilters = async (
        def: CollectionDefinition,
        filters: DocumentFilter[],
        locale: string,
        options: ReadOptions = {}
      ) => {
        const { documents } = await adapter.queries.documents.findDocuments({
          collection_id: ids[def.path]!,
          filters,
          locale,
          pageSize: 100,
          ...options,
        })
        return documents.map((d: any) => d.document_id as string)
      }
      /** The collection's document ids in a sort's order. */
      const ordered = async (def: CollectionDefinition, sort: FieldSort, locale: string) => {
        const { documents } = await adapter.queries.documents.findDocuments({
          collection_id: ids[def.path]!,
          sort,
          locale,
          pageSize: 100,
        })
        return documents.map((d: any) => d.document_id as string)
      }
      const parsedSort = (def: CollectionDefinition, spec: SortSpec) => {
        const { fieldSort } = parseSort(spec, def)
        if (!fieldSort) throw new Error('expected a field sort')
        return fieldSort
      }

      it('case 9: case 6, a where-clause on the field in fr matches the en value and not the fr value. Case 2, a where-clause in fr matches the shared value', async () => {
        const shared = await write(caseNineShared, {
          title: { en: 'Title EN', fr: 'Titre FR', de: 'Titel DE' },
        })
        title9.localized = false
        expect(await matching(caseNineShared, { title: 'Title EN' }, 'fr')).toEqual([shared.id])
        expect(await matching(caseNineShared, { title: 'Titre FR' }, 'fr')).toEqual([])

        const localized = await write(caseNineLocalized, {
          title: { en: 'Title EN', fr: 'Titre FR' },
          summary: 'Shared',
        })
        summary9.localized = true
        expect(await matching(caseNineLocalized, { summary: 'Shared' }, 'fr')).toEqual([
          localized.id,
        ])
      })

      it('case 13: sort on a now-shared field with en and fr rows, read in fr: documents order by the en value', async () => {
        // The fr values order the documents the other way round.
        const a = await write(caseThirteen, { title: { en: 'A', fr: 'Z' } })
        const b = await write(caseThirteen, { title: { en: 'B', fr: 'Y' } })
        title13.localized = false
        expect(
          await ordered(caseThirteen, parsedSort(caseThirteen, { title: 'asc' }), 'fr')
        ).toEqual([a.id, b.id])
        expect(
          await ordered(caseThirteen, parsedSort(caseThirteen, { title: 'desc' }), 'fr')
        ).toEqual([b.id, a.id])
      })

      it('uses each document source locale for now-shared filters and sorts in one result set', async () => {
        const english = await write(caseSourceLocales, { title: { en: 'B', fr: '0' } })
        const french = await write(caseSourceLocales, { title: { en: 'Y', fr: 'A' } })
        await hooks.seedDocumentSourceLocale(french.id, 'fr')
        sourceTitle.localized = false

        // The default (en) and requested (fr) locale both give a different
        // ordering from the two documents' individual source locales.
        expect(
          await ordered(caseSourceLocales, parsedSort(caseSourceLocales, { title: 'asc' }), 'fr')
        ).toEqual([french.id, english.id])
        expect(
          await ordered(caseSourceLocales, parsedSort(caseSourceLocales, { title: 'desc' }), 'en')
        ).toEqual([english.id, french.id])
        expect(await matching(caseSourceLocales, { title: { $in: ['A', 'B'] } }, 'fr')).toEqual(
          expect.arrayContaining([english.id, french.id])
        )
        expect(await matching(caseSourceLocales, { title: { $in: ['Y', '0'] } }, 'fr')).toEqual([])
        expect((await byId(caseSourceLocales, english, 'fr')).fields.title).toBe('B')
        expect((await byId(caseSourceLocales, french, 'en')).fields.title).toBe('A')
      })

      it('uses the relation target source locale when it differs from the parent and default', async () => {
        const target = await write(caseSourceTarget, { title: { en: 'Target EN', fr: 'Cible FR' } })
        await hooks.seedDocumentSourceLocale(target.id, 'fr')
        const parent = await write(caseSourceParent, {
          title: { en: 'Parent EN', fr: 'Parent FR' },
          topic: { targetDocumentId: target.id, targetCollectionId: ids[caseSourceTarget.path] },
        })
        targetSourceTitle.localized = false

        expect(await matching(caseSourceParent, { topic: { title: 'Cible FR' } }, 'en')).toEqual([
          parent.id,
        ])
        expect(await matching(caseSourceParent, { topic: { title: 'Target EN' } }, 'en')).toEqual(
          []
        )
      })

      describe('case 19: filter and sort precedence on a version holding both a shared row and a locale row for one path', () => {
        // Each document's current version holds `title:all` and `title:en`,
        // constructed as in case 22: written localized, toggled to shared, then
        // saved in fr before this fix (copy-forward carries the stale en row).
        // The shared values order the documents one way and the en values the
        // other, so a sort that picks the losing row fails in one direction.
        let a: Doc
        let b: Doc
        const mixed = async (en: string, sharedValue: string) => {
          title19.localized = true
          const doc = await write(caseNineteen, { title: { en, fr: `${en} FR` } })
          title19.localized = false
          await adapter.commands.documents.createDocumentVersion({
            collectionId: ids[caseNineteen.path]!,
            collectionVersion: 1,
            collectionConfig: caseNineteen,
            action: 'update',
            documentId: doc.id,
            documentData: { title: sharedValue },
            locale: 'fr',
            previousVersionId: doc.versionId,
            status: 'published',
          })
          expect(await storedPairs(caseNineteen, doc.id)).toEqual(['title:all', 'title:en'])
          return doc
        }
        beforeAll(async () => {
          a = await mixed('Z', 'A')
          b = await mixed('Y', 'B')
        })

        it('a sort orders by the winning value in both directions', async () => {
          // Now shared: the shared row wins (4.2).
          title19.localized = false
          const sort = (direction: 'asc' | 'desc') => parsedSort(caseNineteen, { title: direction })
          expect(await ordered(caseNineteen, sort('asc'), 'en')).toEqual([a.id, b.id])
          expect(await ordered(caseNineteen, sort('desc'), 'en')).toEqual([b.id, a.id])
          // Now localized: the effective-locale row wins (4.1).
          title19.localized = true
          expect(await ordered(caseNineteen, sort('asc'), 'en')).toEqual([b.id, a.id])
          expect(await ordered(caseNineteen, sort('desc'), 'en')).toEqual([a.id, b.id])
        })

        it("a where filter's behaviour matches the decision in 4.4: it matches the winning value and, with no NOT EXISTS guard, may match the losing value", async () => {
          title19.localized = false
          expect(await matching(caseNineteen, { title: 'A' }, 'en')).toEqual([a.id])
          expect(await matching(caseNineteen, { title: 'Z' }, 'en')).toEqual([a.id])
          title19.localized = true
          expect(await matching(caseNineteen, { title: 'Z' }, 'en')).toEqual([a.id])
          expect(await matching(caseNineteen, { title: 'A' }, 'en')).toEqual([a.id])
        })
      })

      it('case 20: withheld locale (4.2a): a where filter on a now-localized field does not match its shared value on a public exact read of an ineligible locale', async () => {
        // `fr` lacks the localized title, so it is incomplete and ineligible.
        const doc = await write(caseTwenty, {
          title: { en: 'Title EN' },
          summary: 'Shared',
          sku: { en: 'SKU EN', fr: 'SKU FR' },
        })
        summary20.localized = true
        sku20.localized = false
        const publicExact = { localeVisibility: 'public' as const }

        expect(await matching(caseTwenty, { summary: 'Shared' }, 'fr', publicExact)).toEqual([])
        // The same filter matches where the locale is not withheld.
        expect(await matching(caseTwenty, { summary: 'Shared' }, 'en', publicExact)).toEqual([
          doc.id,
        ])
        expect(
          await matching(caseTwenty, { summary: 'Shared' }, 'fr', { localeVisibility: 'editorial' })
        ).toEqual([doc.id])
        // A now-shared field is never withheld: it matches its source value (case 12).
        expect(await matching(caseTwenty, { sku: 'SKU EN' }, 'fr', publicExact)).toEqual([doc.id])
        expect(await matching(caseTwenty, { sku: 'SKU FR' }, 'fr', publicExact)).toEqual([])
      })

      it('case 21: a relation sub-filter on a toggled field of the target collection follows the table in 4.4', async () => {
        const topic = await write(caseTwentyOneTarget, {
          title: { en: 'Topic EN', fr: 'Sujet FR' },
          name: { en: 'Name EN', fr: 'Nom FR' },
          label: 'Shared label',
        })
        const note = await write(caseTwentyOne, {
          title: { en: 'Note EN', fr: 'Note FR' },
          topic: { targetDocumentId: topic.id, targetCollectionId: ids[caseTwentyOneTarget.path] },
        })
        name21.localized = false
        label21.localized = true

        // Now shared: the target's source-locale row, not its fr row.
        expect(await matching(caseTwentyOne, { topic: { name: 'Name EN' } }, 'fr')).toEqual([
          note.id,
        ])
        expect(await matching(caseTwentyOne, { topic: { name: 'Nom FR' } }, 'fr')).toEqual([])
        // Now localized: the target's shared row serves fr.
        expect(await matching(caseTwentyOne, { topic: { label: 'Shared label' } }, 'fr')).toEqual([
          note.id,
        ])
      })

      it('compatibility: a hand-built FieldFilter and FieldSort without localized, on a localized field with en and fr rows, read in fr, match and order as before (the fr row)', async () => {
        const a = await write(caseCompatibility, { title: { en: 'A', fr: 'Z' } })
        const b = await write(caseCompatibility, { title: { en: 'B', fr: 'Y' } })
        const titleIs = (value: string): FieldFilter => ({
          kind: 'field',
          fieldName: 'title',
          storeType: 'text',
          valueColumn: 'value',
          operator: '$eq',
          value,
        })
        const byTitle = (direction: 'asc' | 'desc'): FieldSort => ({
          fieldName: 'title',
          storeType: 'text',
          valueColumn: 'value',
          direction,
        })
        expect(await matchingFilters(caseCompatibility, [titleIs('Z')], 'fr')).toEqual([a.id])
        expect(await matchingFilters(caseCompatibility, [titleIs('A')], 'fr')).toEqual([])
        expect(await ordered(caseCompatibility, byTitle('asc'), 'fr')).toEqual([b.id, a.id])
        expect(await ordered(caseCompatibility, byTitle('desc'), 'fr')).toEqual([a.id, b.id])
      })
    })

    describe('save-path reads on an adapter with a single pool connection', () => {
      // A lifecycle save holds one connection for its write transaction. The
      // mismatch query and the merged write's map read run inside it, so they
      // must use that connection: on this adapter, a read that asks the pool
      // for a second connection never completes. `bounded` turns that wait into
      // a failure, because some drivers queue the request instead of timing out.
      let solo: { adapter: IDbAdapter; close(): Promise<void> }
      const bounded = <T>(work: Promise<T>) =>
        Promise.race([
          work,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('the save waited for a second pool connection')),
              5000
            )
          ),
        ])
      beforeAll(async () => {
        solo = await hooks.createSingleConnectionAdapter([...toggled])
      })
      afterAll(() => solo?.close())

      const soloSave = async (
        def: CollectionDefinition,
        doc: Doc,
        locale: string,
        data: Record<string, any>
      ) =>
        bounded(
          updateDocument(lifecycle(def, solo.adapter), {
            documentId: doc.id,
            expectedRevision: await revisionOf(def, doc.id),
            locale,
            data,
          })
        )

      it('an ordinary single-locale save completes with no spare connection', async () => {
        const doc = await write(caseSoloClean, {
          title: { en: 'Title EN', fr: 'Titre FR' },
          summary: 'Shared',
        })
        await soloSave(caseSoloClean, doc, 'fr', {
          ...(await fieldsOf(caseSoloClean, doc, 'fr')),
          title: 'Titre FR 2',
        })
        expect((await byId(caseSoloClean, doc, 'en')).fields.title).toBe('Title EN')
        expect((await byId(caseSoloClean, doc, 'fr')).fields.title).toBe('Titre FR 2')
      })

      it('a mismatch repair save (case 4) completes with no spare connection', async () => {
        const doc = await write(caseSoloToggled, {
          title: { en: 'Title EN', fr: 'Titre FR' },
          summary: 'Shared',
        })
        summarySoloToggled.localized = true
        await soloSave(caseSoloToggled, doc, 'fr', {
          ...(await fieldsOf(caseSoloToggled, doc, 'fr')),
          summary: 'Résumé FR',
        })
        expect((await byId(caseSoloToggled, doc, 'en')).fields.summary).toBe('Shared')
        expect(await storedPairs(caseSoloToggled, doc.id)).not.toContain('summary:all')
      })

      it('a copy-to-locale repair (review focus 4) completes with no spare connection', async () => {
        const doc = await write(caseSoloCopy, {
          title: { en: 'Title EN', fr: 'Titre FR' },
          summary: 'Shared',
        })
        summarySoloCopy.localized = true
        const result = await bounded(
          copyToLocale(lifecycle(caseSoloCopy, solo.adapter), {
            documentId: doc.id,
            expectedRevision: await revisionOf(caseSoloCopy, doc.id),
            sourceLocale: 'en',
            targetLocale: 'fr',
            overwrite: false,
          })
        )
        expect(result.documentVersionId).not.toBe(doc.versionId)
        expect(await storedPairs(caseSoloCopy, doc.id)).not.toContain('summary:all')
      })
    })
  })
}
