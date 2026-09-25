/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Conformance for the advertised-locale delivery gate (`localeVisibility`).
 *
 * In a collection with `advertiseLocales: true`, a `'public'` read treats a
 * complete but unchecked translation exactly like a missing one: `'fallback'`
 * falls back to the source, `'omit'` excludes the document, and an exact read
 * withholds localized values. `'editorial'` (the adapter default) ignores the
 * checkboxes. The source locale is always eligible, and completeness is always
 * required. Every reconstructed result reports `resolved_locale`.
 *
 * Fixture: English source, a localized title in the text store and a localized
 * rich-text body in the JSON store. Spanish is complete; German translates only
 * the title, so it is incomplete.
 */

import type { CollectionDefinition, IDbAdapter, LocaleVisibility } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const fields: CollectionDefinition['fields'] = [
  { name: 'title', type: 'text', localized: true, optional: true },
  { name: 'body', type: 'richText', localized: true, optional: true },
  { name: 'sku', type: 'text', optional: true },
  {
    name: 'sections',
    type: 'array',
    optional: true,
    fields: [
      { name: 'heading', type: 'text', localized: true, optional: true },
      { name: 'code', type: 'text', optional: true },
    ],
  },
]

const AdvertisedConfig: CollectionDefinition = {
  path: `locale-visibility-adv-${timestamp}`,
  labels: { singular: 'Advertised', plural: 'Advertised' },
  advertiseLocales: true,
  fields,
}

const PlainConfig: CollectionDefinition = {
  path: `locale-visibility-plain-${timestamp}`,
  labels: { singular: 'Plain', plural: 'Plain' },
  fields,
}

type Read = {
  document_id: string
  document_version_id: string
  fields: Record<string, any>
  resolved_locale: string | null
  _availableVersionLocales: string[]
  _localeAgnostic: boolean
}

const richText = (text: string) => ({ root: { type: 'root', children: [{ type: 'text', text }] } })

export function localeVisibilitySuite(hooks: ConformanceHooks): void {
  describe('advertised-locale delivery gate (localeVisibility)', () => {
    let adapter: IDbAdapter
    const ids: Record<string, string> = {}
    let seq = 0

    async function create(
      config: CollectionDefinition,
      documentData: Record<string, unknown>,
      status: 'draft' | 'published' = 'published'
    ) {
      seq += 1
      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId: ids[config.path] as string,
        collectionVersion: 1,
        collectionConfig: config,
        action: 'create',
        documentData,
        path: `vis-${timestamp}-${seq}`,
        locale: 'all',
        status,
      })
      return result.document
    }

    /** English source; Spanish complete; German title only (incomplete). */
    function translated(prefix: string) {
      return {
        title: { en: `${prefix} EN`, es: `${prefix} ES`, de: `${prefix} DE` },
        body: { en: richText(`${prefix} body EN`), es: richText(`${prefix} body ES`) },
        sku: `${prefix}-sku`,
      }
    }

    function check(config: CollectionDefinition, documentId: string, locales: string[]) {
      return adapter.commands.documents.setDocumentAvailableLocales({
        documentId,
        collectionId: ids[config.path] as string,
        availableLocales: locales,
      })
    }

    function detail(
      config: CollectionDefinition,
      documentId: string,
      locale: string,
      onMissingLocale: 'fallback' | 'omit' | 'empty' | undefined,
      localeVisibility?: LocaleVisibility,
      readMode: 'published' | 'any' = 'published'
    ) {
      return adapter.queries.documents.getDocumentById({
        collection_id: ids[config.path] as string,
        document_id: documentId,
        locale,
        onMissingLocale,
        localeVisibility,
        readMode,
      }) as Promise<Read | null>
    }

    async function list(
      config: CollectionDefinition,
      locale: string,
      onMissingLocale: 'fallback' | 'omit' | 'empty',
      localeVisibility?: LocaleVisibility,
      fieldsSelect?: string[]
    ) {
      const result = await adapter.queries.documents.findDocuments({
        collection_id: ids[config.path] as string,
        locale,
        onMissingLocale,
        localeVisibility,
        readMode: 'published',
        fields: fieldsSelect,
        pageSize: 200,
      })
      return {
        total: result.total,
        byId: new Map(result.documents.map((d) => [d.document_id as string, d as Read])),
      }
    }

    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([AdvertisedConfig, PlainConfig])
      for (const config of [AdvertisedConfig, PlainConfig]) {
        const [row] = await adapter.commands.collections.create(config.path, config)
        if (row == null) throw new Error(`failed to create ${config.path}`)
        ids[config.path] = row.id
      }
    })

    afterAll(async () => {
      for (const config of [AdvertisedConfig, PlainConfig]) {
        try {
          await adapter.commands.collections.delete(ids[config.path] as string)
        } catch (error) {
          console.error('Failed to clean up collection:', error)
        }
      }
    })

    // --- fallback --------------------------------------------------------

    it('public fallback serves the source for a complete but unchecked translation', async () => {
      const doc = await create(AdvertisedConfig, translated('Fb'))
      const pub = await detail(AdvertisedConfig, doc.document_id, 'es', 'fallback', 'public')
      const edi = await detail(AdvertisedConfig, doc.document_id, 'es', 'fallback', 'editorial')
      expect(pub?.fields.title).toBe('Fb EN')
      expect(pub?.resolved_locale).toBe('en')
      expect(edi?.fields.title).toBe('Fb ES')
      expect(edi?.resolved_locale).toBe('es')
    })

    it('an omitted visibility is editorial at the adapter', async () => {
      const doc = await create(AdvertisedConfig, translated('Def'))
      const read = await detail(AdvertisedConfig, doc.document_id, 'es', 'fallback')
      expect(read?.fields.title).toBe('Def ES')
    })

    it('checking and unchecking a locale changes the next public read', async () => {
      const doc = await create(AdvertisedConfig, translated('Chk'))
      await check(AdvertisedConfig, doc.document_id, ['es'])
      const checked = await detail(AdvertisedConfig, doc.document_id, 'es', 'fallback', 'public')
      expect(checked?.fields.title).toBe('Chk ES')
      expect(checked?.resolved_locale).toBe('es')

      await check(AdvertisedConfig, doc.document_id, [])
      const unchecked = await detail(AdvertisedConfig, doc.document_id, 'es', 'fallback', 'public')
      expect(unchecked?.fields.title).toBe('Chk EN')
    })

    it('a checked but incomplete translation stays unavailable', async () => {
      const doc = await create(AdvertisedConfig, translated('Inc'))
      await check(AdvertisedConfig, doc.document_id, ['de'])
      const read = await detail(AdvertisedConfig, doc.document_id, 'de', 'fallback', 'public')
      expect(read?.fields.title).toBe('Inc EN')
      expect(read?.resolved_locale).toBe('en')
    })

    it('a title-only public list falls back for an unchecked translation', async () => {
      const doc = await create(AdvertisedConfig, translated('Proj'))
      const { byId } = await list(AdvertisedConfig, 'es', 'fallback', 'public', ['title'])
      expect(byId.get(doc.document_id)?.fields.title).toBe('Proj EN')
      expect(byId.get(doc.document_id)?.resolved_locale).toBe('en')
    })

    it('populate batch reads resolve each target under the requested visibility', async () => {
      const doc = await create(AdvertisedConfig, translated('Batch'))
      const batch = (visibility: LocaleVisibility) =>
        adapter.queries.documents.getDocumentsByDocumentIds({
          collection_id: ids[AdvertisedConfig.path] as string,
          document_ids: [doc.document_id],
          locale: 'es',
          fields: ['title'],
          readMode: 'published',
          localeVisibility: visibility,
        })
      const [pub] = await batch('public')
      const [edi] = await batch('editorial')
      expect(pub?.fields.title).toBe('Batch EN')
      expect(pub?.resolved_locale).toBe('en')
      expect(edi?.fields.title).toBe('Batch ES')
      expect(edi?.resolved_locale).toBe('es')
    })

    // --- omit ------------------------------------------------------------

    it('public omit excludes an unchecked translation from detail, list and total', async () => {
      const doc = await create(AdvertisedConfig, translated('Om'))
      expect(await detail(AdvertisedConfig, doc.document_id, 'es', 'omit', 'public')).toBeNull()
      const pubList = await list(AdvertisedConfig, 'es', 'omit', 'public')
      expect(pubList.byId.has(doc.document_id)).toBe(false)

      const ediList = await list(AdvertisedConfig, 'es', 'omit', 'editorial')
      expect(ediList.byId.has(doc.document_id)).toBe(true)
      expect(ediList.total).toBeGreaterThan(pubList.total)

      await check(AdvertisedConfig, doc.document_id, ['es'])
      const read = await detail(AdvertisedConfig, doc.document_id, 'es', 'omit', 'public')
      expect(read?.fields.title).toBe('Om ES')
      expect(read?.resolved_locale).toBe('es')
      expect((await list(AdvertisedConfig, 'es', 'omit', 'public')).byId.has(doc.document_id)).toBe(
        true
      )
    })

    it('public omit always admits the source locale, checked or not', async () => {
      const doc = await create(AdvertisedConfig, translated('OmSrc'))
      const read = await detail(AdvertisedConfig, doc.document_id, 'en', 'omit', 'public')
      expect(read?.fields.title).toBe('OmSrc EN')
    })

    // --- exact reads (empty / omitted policy) ----------------------------

    it('public empty withholds localized values of an unchecked translation', async () => {
      const doc = await create(AdvertisedConfig, translated('Emp'))
      const pub = await detail(AdvertisedConfig, doc.document_id, 'es', 'empty', 'public')
      expect(pub?.fields.title).toBeUndefined()
      expect(pub?.fields.body).toBeUndefined()
      expect(pub?.fields.sku, 'non-localized values are kept').toBe('Emp-sku')
      expect(pub?.resolved_locale).toBeNull()

      const edi = await detail(AdvertisedConfig, doc.document_id, 'es', 'empty', 'editorial')
      expect(edi?.fields.title).toBe('Emp ES')
      expect(edi?.resolved_locale).toBe('es')
    })

    it('public empty withholds a checked but incomplete translation', async () => {
      const doc = await create(AdvertisedConfig, translated('EmpInc'))
      await check(AdvertisedConfig, doc.document_id, ['de'])
      const pub = await detail(AdvertisedConfig, doc.document_id, 'de', 'empty', 'public')
      expect(pub?.fields.title).toBeUndefined()
      expect(pub?.resolved_locale).toBeNull()
      // The editor still sees the saved partial translation.
      const edi = await detail(AdvertisedConfig, doc.document_id, 'de', 'empty', 'editorial')
      expect(edi?.fields.title).toBe('EmpInc DE')
      expect(edi?.fields.body).toBeUndefined()
      expect(edi?.resolved_locale).toBe('de')
    })

    it('public exact reads serve the source even with every checkbox off', async () => {
      const doc = await create(AdvertisedConfig, translated('Src'))
      const read = await detail(AdvertisedConfig, doc.document_id, 'en', 'empty', 'public')
      expect(read?.fields.title).toBe('Src EN')
      expect(read?.resolved_locale).toBe('en')
    })

    it('a public exact list read withholds per document', async () => {
      const unchecked = await create(AdvertisedConfig, translated('LstU'))
      const checked = await create(AdvertisedConfig, translated('LstC'))
      await check(AdvertisedConfig, checked.document_id, ['es'])
      const { byId } = await list(AdvertisedConfig, 'es', 'empty', 'public')
      expect(byId.get(unchecked.document_id)?.fields.title).toBeUndefined()
      expect(byId.get(unchecked.document_id)?.resolved_locale).toBeNull()
      expect(byId.get(checked.document_id)?.fields.title).toBe('LstC ES')
      expect(byId.get(checked.document_id)?.resolved_locale).toBe('es')
    })

    // --- collections without advertiseLocales -----------------------------

    it('a collection without advertiseLocales needs completeness but no checkbox', async () => {
      const doc = await create(PlainConfig, translated('Pl'))
      const es = await detail(PlainConfig, doc.document_id, 'es', 'fallback', 'public')
      expect(es?.fields.title).toBe('Pl ES')
      const de = await detail(PlainConfig, doc.document_id, 'de', 'fallback', 'public')
      expect(de?.fields.title).toBe('Pl EN')
      expect(
        (await detail(PlainConfig, doc.document_id, 'es', 'omit', 'public'))?.fields.title
      ).toBe('Pl ES')
    })

    it('public empty withholds an incomplete translation even without advertiseLocales', async () => {
      const doc = await create(PlainConfig, translated('PlEmp'))
      const pub = await detail(PlainConfig, doc.document_id, 'de', 'empty', 'public')
      expect(pub?.fields.title).toBeUndefined()
      expect(pub?.fields.sku).toBe('PlEmp-sku')
      const edi = await detail(PlainConfig, doc.document_id, 'de', 'empty', 'editorial')
      expect(edi?.fields.title).toBe('PlEmp DE')
    })

    it('a locale-agnostic document reports a null resolved locale everywhere', async () => {
      const doc = await create(AdvertisedConfig, { sku: 'agnostic' })
      for (const policy of ['fallback', 'omit', 'empty'] as const) {
        const read = await detail(AdvertisedConfig, doc.document_id, 'es', policy, 'public')
        expect(read?.fields.sku).toBe('agnostic')
        expect(read?._localeAgnostic).toBe(true)
        expect(read?.resolved_locale).toBeNull()
      }
    })

    it('a multi-locale editorial read reports a null resolved locale', async () => {
      const doc = await create(AdvertisedConfig, translated('All'))
      const read = await detail(AdvertisedConfig, doc.document_id, 'all', undefined, 'editorial')
      expect(read?.fields.title).toMatchObject({ en: 'All EN', es: 'All ES' })
      expect(read?.resolved_locale).toBeNull()
    })

    it('a non-localized projection keeps the document resolved locale', async () => {
      const doc = await create(AdvertisedConfig, translated('SkuOnly'))
      await check(AdvertisedConfig, doc.document_id, ['es'])
      const { byId } = await list(AdvertisedConfig, 'es', 'fallback', 'public', ['sku'])
      expect(byId.get(doc.document_id)?.resolved_locale).toBe('es')
    })

    it('a version read reports the requested locale it restored', async () => {
      const doc = await create(AdvertisedConfig, translated('Ver'))
      const read = (await adapter.queries.documents.getDocumentByVersion({
        document_version_id: doc.id,
        locale: 'es',
      })) as Read | null
      expect(read?.fields.title).toBe('Ver ES')
      expect(read?.resolved_locale).toBe('es')
    })

    // --- version selection comes first ------------------------------------

    it('a draft-only translation stays public-invisible even when checked', async () => {
      const published = await create(AdvertisedConfig, {
        title: { en: 'Draft EN' },
        body: { en: richText('Draft body EN') },
        sku: 'draft-only',
      })
      await adapter.commands.documents.createDocumentVersion({
        documentId: published.document_id,
        collectionId: ids[AdvertisedConfig.path] as string,
        collectionVersion: 1,
        collectionConfig: AdvertisedConfig,
        action: 'update',
        documentData: { title: 'Draft ES', body: richText('Draft body ES'), sku: 'draft-only' },
        locale: 'es',
        status: 'draft',
        previousVersionId: published.id,
      })
      await check(AdvertisedConfig, published.document_id, ['es'])

      const pub = await detail(AdvertisedConfig, published.document_id, 'es', 'fallback', 'public')
      expect(pub?.fields.title).toBe('Draft EN')
      expect(pub?._availableVersionLocales, 'metadata describes the published version').toEqual([
        'en',
      ])
      const preview = await detail(
        AdvertisedConfig,
        published.document_id,
        'es',
        'fallback',
        'editorial',
        'any'
      )
      expect(preview?.fields.title).toBe('Draft ES')
    })

    it('a newer incomplete draft falls back within itself, never to an older version', async () => {
      const published = await create(AdvertisedConfig, translated('Nd'))
      await check(AdvertisedConfig, published.document_id, ['es'])
      // The newer draft drops the Spanish body, so Spanish is incomplete on it.
      await adapter.commands.documents.createDocumentVersion({
        documentId: published.document_id,
        collectionId: ids[AdvertisedConfig.path] as string,
        collectionVersion: 1,
        collectionConfig: AdvertisedConfig,
        action: 'update',
        documentData: {
          title: { en: 'Nd2 EN', es: 'Nd2 ES' },
          body: { en: richText('Nd2 body EN') },
          sku: 'Nd-sku',
        },
        locale: 'all',
        status: 'draft',
        previousVersionId: published.id,
      })

      const latest = await detail(
        AdvertisedConfig,
        published.document_id,
        'es',
        'fallback',
        'editorial',
        'any'
      )
      expect(latest?.fields.title).toBe('Nd2 EN')
      const pub = await detail(AdvertisedConfig, published.document_id, 'es', 'fallback', 'public')
      expect(pub?.fields.title).toBe('Nd ES')
    })

    it('public empty withholds nested localized values but keeps structure', async () => {
      const doc = await create(AdvertisedConfig, {
        ...translated('Nest'),
        sections: [
          { heading: { en: 'One EN', es: 'One ES' }, code: 'A' },
          { heading: { en: 'Two EN', es: 'Two ES' }, code: 'B' },
        ],
      })
      const pub = await detail(AdvertisedConfig, doc.document_id, 'es', 'empty', 'public')
      const sections = pub?.fields.sections as Array<Record<string, any>>
      expect(sections).toHaveLength(2)
      expect(sections.map((item) => item.code)).toEqual(['A', 'B'])
      expect(sections.every((item) => typeof item._id === 'string')).toBe(true)
      expect(sections.map((item) => item.heading)).toEqual([undefined, undefined])
      expect(pub?.resolved_locale).toBeNull()

      const edi = await detail(AdvertisedConfig, doc.document_id, 'es', 'empty', 'editorial')
      const ediSections = edi?.fields.sections as Array<Record<string, any>>
      expect(ediSections.map((item) => item.heading)).toEqual(['One ES', 'Two ES'])
      expect(ediSections.map((item) => item._id)).toEqual(sections.map((item) => item._id))
    })

    // --- the source exception needs no ledger row ---------------------------

    it('omit admits the source locale even when the ledger has no row for it', async () => {
      // The source (en) has no localized values, so the version's ledger lists
      // only the locale that has content; the source is absent from it.
      for (const config of [AdvertisedConfig, PlainConfig]) {
        const doc = await create(config, { title: { es: 'Only ES' }, sku: 'no-source-row' })
        for (const visibility of ['public', 'editorial'] as const) {
          const read = await detail(config, doc.document_id, 'en', 'omit', visibility)
          expect(read?._availableVersionLocales, config.path).toEqual(['es'])
          expect(read?.fields.sku).toBe('no-source-row')
          expect(read?.resolved_locale).toBe('en')
          const { byId, total } = await list(config, 'en', 'omit', visibility)
          expect(byId.has(doc.document_id), `${config.path} ${visibility} list`).toBe(true)
          expect(total).toBe(byId.size)
        }
      }
    })

    // --- the locale-agnostic discriminator on every reconstructed surface -----

    it('batch, version and multi-locale results carry _localeAgnostic', async () => {
      const doc = await create(AdvertisedConfig, { sku: 'agnostic-surfaces' })
      const [batch] = await adapter.queries.documents.getDocumentsByDocumentIds({
        collection_id: ids[AdvertisedConfig.path] as string,
        document_ids: [doc.document_id],
        locale: 'es',
        readMode: 'published',
        localeVisibility: 'public',
      })
      expect(batch?._localeAgnostic).toBe(true)
      expect(batch?.resolved_locale).toBeNull()

      const version = (await adapter.queries.documents.getDocumentByVersion({
        document_version_id: doc.id,
        locale: 'es',
      })) as Read | null
      expect(version?._localeAgnostic).toBe(true)
      expect(version?.resolved_locale).toBeNull()

      const all = await detail(AdvertisedConfig, doc.document_id, 'all', undefined, 'editorial')
      expect(all?._localeAgnostic).toBe(true)
      expect(all?.resolved_locale).toBeNull()
    })

    it('a localized version reports _localeAgnostic false on the same surfaces', async () => {
      const doc = await create(AdvertisedConfig, translated('NotAgnostic'))
      const [batch] = await adapter.queries.documents.getDocumentsByDocumentIds({
        collection_id: ids[AdvertisedConfig.path] as string,
        document_ids: [doc.document_id],
        locale: 'es',
        localeVisibility: 'public',
      })
      expect(batch?._localeAgnostic).toBe(false)
      const version = (await adapter.queries.documents.getDocumentByVersion({
        document_version_id: doc.id,
        locale: 'es',
      })) as Read | null
      expect(version?._localeAgnostic).toBe(false)
    })

    it('public metadata describes the published version while fields obey the checkbox', async () => {
      // Published: Spanish complete and unchecked. A newer draft adds French.
      const published = await create(AdvertisedConfig, translated('M1'))
      await adapter.commands.documents.createDocumentVersion({
        documentId: published.document_id,
        collectionId: ids[AdvertisedConfig.path] as string,
        collectionVersion: 1,
        collectionConfig: AdvertisedConfig,
        action: 'update',
        documentData: { title: 'M1 FR', body: richText('M1 body FR'), sku: 'M1-sku' },
        locale: 'fr',
        status: 'draft',
        previousVersionId: published.id,
      })

      const es = await detail(AdvertisedConfig, published.document_id, 'es', 'fallback', 'public')
      expect(es?._availableVersionLocales).toContain('es')
      expect(es?._availableVersionLocales, 'draft-only French is not published').not.toContain('fr')
      expect(es?.fields.title, 'unchecked Spanish is withheld').toBe('M1 EN')
      const fr = await detail(AdvertisedConfig, published.document_id, 'fr', 'fallback', 'public')
      expect(fr?.fields.title).toBe('M1 EN')

      await check(AdvertisedConfig, published.document_id, ['es', 'fr'])
      const checkedEs = await detail(
        AdvertisedConfig,
        published.document_id,
        'es',
        'fallback',
        'public'
      )
      expect(checkedEs?.fields.title).toBe('M1 ES')
      const checkedFr = await detail(
        AdvertisedConfig,
        published.document_id,
        'fr',
        'fallback',
        'public'
      )
      expect(checkedFr?.fields.title, 'checking French cannot publish the draft').toBe('M1 EN')
    })

    it('public metadata exposes the complete but unchecked published ledger', async () => {
      const doc = await create(AdvertisedConfig, translated('Meta'))
      const read = await detail(AdvertisedConfig, doc.document_id, 'es', 'fallback', 'public')
      expect(read?._availableVersionLocales).toEqual(expect.arrayContaining(['en', 'es']))
      expect(read?._availableVersionLocales).not.toContain('de')
    })
  })
}
