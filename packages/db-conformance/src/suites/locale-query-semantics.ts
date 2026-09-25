/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Conformance for localized query semantics: field filters, the list text
 * query, field sorts and relation predicates evaluate each document's
 * localized values in the locale the read actually shows for that document.
 *
 *   - `'fallback'`: the requested locale when eligible, otherwise the source.
 *   - public exact reads: an unavailable translation behaves as absent; it
 *     matches nothing and is not replaced by the source.
 *   - editorial reads: completeness decides; checkboxes are ignored.
 *
 * A withheld (complete but unchecked) or incomplete translation can neither
 * match a predicate nor influence ordering while the response shows the source.
 */

import type {
  CollectionDefinition,
  DocumentFilter,
  FieldFilter,
  FieldSort,
  IDbAdapter,
  LocaleVisibility,
  MissingLocalePolicy,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const localizedFields: CollectionDefinition['fields'] = [
  { name: 'title', type: 'text', localized: true, optional: true },
  { name: 'body', type: 'richText', localized: true, optional: true },
  { name: 'sku', type: 'text', optional: true },
]

const Topics: CollectionDefinition = {
  path: `query-topics-${timestamp}`,
  labels: { singular: 'Topic', plural: 'Topics' },
  useAsTitle: 'title',
  advertiseLocales: true,
  fields: [
    ...localizedFields,
    // A second relation hop, into a collection without advertiseLocales.
    { name: 'tag', type: 'relation', targetCollection: `query-plain-${timestamp}`, optional: true },
  ],
}

const Nodes: CollectionDefinition = {
  path: `query-nodes-${timestamp}`,
  labels: { singular: 'Node', plural: 'Nodes' },
  useAsTitle: 'title',
  advertiseLocales: true,
  tree: true,
  fields: [
    ...localizedFields,
    {
      name: 'topic',
      type: 'relation',
      targetCollection: `query-topics-${timestamp}`,
      optional: true,
    },
  ],
}

const Notes: CollectionDefinition = {
  path: `query-notes-${timestamp}`,
  labels: { singular: 'Note', plural: 'Notes' },
  useAsTitle: 'title',
  advertiseLocales: true,
  fields: [
    ...localizedFields,
    {
      name: 'topic',
      type: 'relation',
      targetCollection: `query-topics-${timestamp}`,
      optional: true,
    },
  ],
}

const Plain: CollectionDefinition = {
  path: `query-plain-${timestamp}`,
  labels: { singular: 'Plain', plural: 'Plain' },
  useAsTitle: 'title',
  fields: [
    ...localizedFields,
    {
      name: 'topic',
      type: 'relation',
      targetCollection: `query-topics-${timestamp}`,
      optional: true,
    },
  ],
}

const richText = (text: string) => ({ root: { type: 'root', children: [{ type: 'text', text }] } })

const titleIs = (value: string): FieldFilter => ({
  kind: 'field',
  fieldName: 'title',
  storeType: 'text',
  valueColumn: 'value',
  operator: '$eq',
  value,
})

const skuIs = (value: string): FieldFilter => ({
  kind: 'field',
  fieldName: 'sku',
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

export function localeQuerySemanticsSuite(hooks: ConformanceHooks): void {
  describe('localized query semantics (filters, text query, sorts, relation hops)', () => {
    let adapter: IDbAdapter
    const ids: Record<string, string> = {}
    let seq = 0

    async function create(config: CollectionDefinition, documentData: Record<string, unknown>) {
      seq += 1
      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId: ids[config.path] as string,
        collectionVersion: 1,
        collectionConfig: config,
        action: 'create',
        documentData,
        path: `query-${timestamp}-${seq}`,
        locale: 'all',
        status: 'published',
      })
      return result.document.document_id as string
    }

    /** English source; Spanish complete. */
    const complete = (en: string, es: string, sku: string) => ({
      title: { en, es },
      body: { en: richText(`${en} body`), es: richText(`${es} body`) },
      sku,
    })

    function check(config: CollectionDefinition, documentId: string, locales: string[]) {
      return adapter.commands.documents.setDocumentAvailableLocales({
        documentId,
        collectionId: ids[config.path] as string,
        availableLocales: locales,
      })
    }

    async function find(
      config: CollectionDefinition,
      options: {
        filters?: DocumentFilter[]
        query?: string
        sort?: FieldSort
        onMissingLocale?: MissingLocalePolicy
        localeVisibility?: LocaleVisibility
        page?: number
        pageSize?: number
        fields?: string[]
        readMode?: 'published' | 'any'
      }
    ) {
      const result = await adapter.queries.documents.findDocuments({
        collection_id: ids[config.path] as string,
        locale: 'es',
        readMode: options.readMode ?? 'published',
        onMissingLocale: options.onMissingLocale ?? 'fallback',
        localeVisibility: options.localeVisibility ?? 'public',
        filters: options.filters,
        query: options.query,
        sort: options.sort,
        page: options.page,
        pageSize: options.pageSize ?? 200,
        fields: options.fields,
      })
      return {
        ids: result.documents.map((d) => d.document_id as string),
        total: result.total,
        // The displayed values and language decision, kept so assertions can
        // check what the read shows as well as which documents it selected.
        rows: result.documents.map((d) => ({
          id: d.document_id as string,
          title: d.fields?.title as string | undefined,
          resolvedLocale: d.resolved_locale as string | null,
        })),
      }
    }

    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([Topics, Notes, Plain, Nodes])
      for (const config of [Topics, Notes, Plain, Nodes]) {
        const [row] = await adapter.commands.collections.create(config.path, config)
        if (row == null) throw new Error(`failed to create ${config.path}`)
        ids[config.path] = row.id
      }
    })

    afterAll(async () => {
      // Topics and Plain reference each other, so no per-collection delete
      // order satisfies the foreign keys; truncate like every suite's setup.
      await hooks.truncate()
    })

    // --- Q1: field filters and the list text query ---------------------------

    it('a public fallback filter matches the shown source, never the withheld translation', async () => {
      const id = await create(Topics, complete('Apple EN', 'Manzana ES', 'q1-a'))
      expect((await find(Topics, { filters: [titleIs('Manzana ES')] })).ids).not.toContain(id)
      expect((await find(Topics, { filters: [titleIs('Apple EN')] })).ids).toContain(id)

      const editorial = { localeVisibility: 'editorial' as const }
      expect(
        (await find(Topics, { ...editorial, filters: [titleIs('Manzana ES')] })).ids
      ).toContain(id)
      expect(
        (await find(Topics, { ...editorial, filters: [titleIs('Apple EN')] })).ids
      ).not.toContain(id)

      await check(Topics, id, ['es'])
      expect((await find(Topics, { filters: [titleIs('Manzana ES')] })).ids).toContain(id)
      expect((await find(Topics, { filters: [titleIs('Apple EN')] })).ids).not.toContain(id)
    })

    it('a public exact read treats a withheld translation as absent, without substituting the source', async () => {
      const id = await create(Topics, complete('Cherry EN', 'Cereza ES', 'q1-empty'))
      const exact = { onMissingLocale: 'empty' as const }
      expect((await find(Topics, { ...exact, filters: [titleIs('Cereza ES')] })).ids).not.toContain(
        id
      )
      expect((await find(Topics, { ...exact, filters: [titleIs('Cherry EN')] })).ids).not.toContain(
        id
      )
      // Non-localized values still match.
      expect((await find(Topics, { ...exact, filters: [skuIs('q1-empty')] })).ids).toContain(id)
      // The editorial exact read matches the saved translation.
      expect(
        (
          await find(Topics, {
            ...exact,
            localeVisibility: 'editorial',
            filters: [titleIs('Cereza ES')],
          })
        ).ids
      ).toContain(id)
    })

    it('the list text query follows the same rule', async () => {
      const id = await create(Topics, complete('Grape EN', 'Uva ES', 'q1-text'))
      expect((await find(Topics, { query: 'Uva' })).ids).not.toContain(id)
      expect((await find(Topics, { query: 'Grape' })).ids).toContain(id)
      expect((await find(Topics, { query: 'Uva', localeVisibility: 'editorial' })).ids).toContain(
        id
      )
    })

    it('an incomplete translation cannot match even without advertiseLocales', async () => {
      // Spanish translates the title only, so Spanish is incomplete.
      const id = await create(Plain, {
        title: { en: 'Pear EN', es: 'Pera ES' },
        body: { en: richText('Pear body') },
        sku: 'q1-plain',
      })
      for (const localeVisibility of ['public', 'editorial'] as const) {
        expect(
          (await find(Plain, { localeVisibility, filters: [titleIs('Pera ES')] })).ids,
          localeVisibility
        ).not.toContain(id)
        expect(
          (await find(Plain, { localeVisibility, filters: [titleIs('Pear EN')] })).ids,
          localeVisibility
        ).toContain(id)
      }
    })

    // --- Q2: field sorts ------------------------------------------------------

    it('sorts order by the values the read shows', async () => {
      // A: English 'Apple', withheld Spanish 'Zzz'. B: checked Spanish 'Mango'.
      const a = await create(Topics, complete('Apple', 'Zzz', 'q2'))
      const b = await create(Topics, complete('Banana', 'Mango', 'q2'))
      await check(Topics, b, ['es'])
      const set = [skuIs('q2')]

      expect((await find(Topics, { filters: set, sort: byTitle('asc') })).ids).toEqual([a, b])
      expect((await find(Topics, { filters: set, sort: byTitle('desc') })).ids).toEqual([b, a])
      // Editorial sees the unchecked 'Zzz'.
      expect(
        (await find(Topics, { filters: set, sort: byTitle('asc'), localeVisibility: 'editorial' }))
          .ids
      ).toEqual([b, a])
      // A public exact read has no Spanish value for A: it sorts as empty (last).
      expect(
        (await find(Topics, { filters: set, sort: byTitle('asc'), onMissingLocale: 'empty' })).ids
      ).toEqual([b, a])
    })

    // --- Q3: relation predicates ---------------------------------------------

    it('relation predicates evaluate each target in its own effective locale', async () => {
      const topic = await create(Topics, complete('Topic EN', 'Topic ES', 'q3-topic'))
      const note = await create(Notes, {
        ...complete('Note EN', 'Note ES', 'q3-note'),
        topic: { targetDocumentId: topic, targetCollectionId: ids[Topics.path] },
      })
      // The note itself is checked in Spanish; its topic is not.
      await check(Notes, note, ['es'])
      const viaTopic = (value: string): DocumentFilter => ({
        kind: 'relation',
        fieldName: 'topic',
        targetCollectionId: ids[Topics.path] as string,
        nested: [titleIs(value)],
      })

      expect((await find(Notes, { filters: [viaTopic('Topic ES')] })).ids).not.toContain(note)
      expect((await find(Notes, { filters: [viaTopic('Topic EN')] })).ids).toContain(note)
      expect(
        (await find(Notes, { filters: [viaTopic('Topic ES')], localeVisibility: 'editorial' })).ids
      ).toContain(note)

      // Inside a combinator, and combined with the note's own Spanish title.
      const either: DocumentFilter = {
        kind: 'or',
        children: [viaTopic('Topic ES'), skuIs('no-such-sku')],
      }
      expect((await find(Notes, { filters: [either] })).ids).not.toContain(note)
      const both: DocumentFilter = {
        kind: 'and',
        children: [viaTopic('Topic EN'), titleIs('Note ES')],
      }
      expect((await find(Notes, { filters: [both] })).ids).toContain(note)
    })

    it('a non-advertised parent still gates its advertised target', async () => {
      const topic = await create(Topics, complete('Hop EN', 'Hop ES', 'q3-hop'))
      const plain = await create(Plain, {
        ...complete('Parent EN', 'Parent ES', 'q3-plain'),
        topic: { targetDocumentId: topic, targetCollectionId: ids[Topics.path] },
      })
      const viaTopic = (value: string): DocumentFilter => ({
        kind: 'relation',
        fieldName: 'topic',
        targetCollectionId: ids[Topics.path] as string,
        nested: [titleIs(value)],
      })
      expect((await find(Plain, { filters: [viaTopic('Hop ES')] })).ids).not.toContain(plain)
      expect((await find(Plain, { filters: [viaTopic('Hop EN')] })).ids).toContain(plain)
      // The parent's own Spanish title is complete and needs no checkbox.
      expect((await find(Plain, { filters: [titleIs('Parent ES')] })).ids).toContain(plain)
    })

    // --- Q4: omit before count and pagination --------------------------------

    it('omit filters before count and pagination; full and projected lists agree', async () => {
      const set = [skuIs('q4')]
      const checked = await create(Topics, complete('Q4 A', 'Q4 A ES', 'q4'))
      await create(Topics, complete('Q4 B', 'Q4 B ES', 'q4'))
      await create(Topics, complete('Q4 C', 'Q4 C ES', 'q4'))
      await check(Topics, checked, ['es'])
      const omit = { onMissingLocale: 'omit' as const, filters: set, sort: byTitle('asc') }

      const pub = await find(Topics, { ...omit, pageSize: 1 })
      expect(pub.total).toBe(1)
      expect(pub.ids).toEqual([checked])

      const page1 = await find(Topics, {
        ...omit,
        localeVisibility: 'editorial',
        pageSize: 2,
        page: 1,
      })
      const page2 = await find(Topics, {
        ...omit,
        localeVisibility: 'editorial',
        pageSize: 2,
        page: 2,
      })
      expect(page1.total).toBe(3)
      expect(page1.ids).toHaveLength(2)
      expect(page2.ids).toHaveLength(1)
      expect(new Set([...page1.ids, ...page2.ids]).size).toBe(3)

      const projected = await find(Topics, {
        ...omit,
        localeVisibility: 'editorial',
        fields: ['title'],
      })
      const full = await find(Topics, { ...omit, localeVisibility: 'editorial' })
      expect(projected).toEqual(full)
    })

    // --- Q3: multi-hop relations, opt-ins and target version selection -------

    const hop = (
      fieldName: string,
      targetPath: string,
      nested: DocumentFilter[]
    ): DocumentFilter => ({
      kind: 'relation',
      fieldName,
      targetCollectionId: ids[targetPath] as string,
      nested,
    })

    it('each hop resolves its own target: advertised topic, then a non-advertised tag', async () => {
      const tag = await create(Plain, complete('MH Tag EN', 'MH Tag ES', 'mh-tag'))
      const topic = await create(Topics, {
        ...complete('MH Topic EN', 'MH Topic ES', 'mh-topic'),
        tag: { targetDocumentId: tag, targetCollectionId: ids[Plain.path] },
      })
      const note = await create(Notes, {
        ...complete('MH Note EN', 'MH Note ES', 'mh-note'),
        topic: { targetDocumentId: topic, targetCollectionId: ids[Topics.path] },
      })
      await check(Notes, note, ['es'])
      const viaTag = (value: string) =>
        hop('topic', Topics.path, [hop('tag', Plain.path, [titleIs(value)])])

      // Second hop: the tag's collection has no checkboxes, so Spanish shows.
      const second = await find(Notes, { filters: [viaTag('MH Tag ES')] })
      expect(second.ids).toContain(note)
      expect(second.rows.find((r) => r.id === note)).toEqual({
        id: note,
        title: 'MH Note ES',
        resolvedLocale: 'es',
      })
      expect((await find(Notes, { filters: [viaTag('MH Tag EN')] })).ids).not.toContain(note)

      // Both hops in one conjunction: the unchecked topic shows its source.
      const both: DocumentFilter = {
        kind: 'and',
        children: [hop('topic', Topics.path, [titleIs('MH Topic EN')]), viaTag('MH Tag ES')],
      }
      expect((await find(Notes, { filters: [both] })).ids).toContain(note)
      const wrong: DocumentFilter = {
        kind: 'and',
        children: [hop('topic', Topics.path, [titleIs('MH Topic ES')]), viaTag('MH Tag ES')],
      }
      expect((await find(Notes, { filters: [wrong] })).ids).not.toContain(note)
    })

    it("a hop evaluates the target's selected version, not a newer draft", async () => {
      // Published: Spanish title only (incomplete) but checked. A newer draft
      // completes Spanish.
      const topic = await create(Topics, {
        title: { en: 'Ver Topic EN', es: 'Ver Topic ES' },
        body: { en: richText('Ver body EN') },
        sku: 'ver-topic',
      })
      await check(Topics, topic, ['es'])
      const current = await adapter.queries.documents.getDocumentById({
        collection_id: ids[Topics.path] as string,
        document_id: topic,
      })
      await adapter.commands.documents.createDocumentVersion({
        documentId: topic,
        collectionId: ids[Topics.path] as string,
        collectionVersion: 1,
        collectionConfig: Topics,
        action: 'update',
        documentData: { title: 'Ver Topic ES', body: richText('Ver body ES'), sku: 'ver-topic' },
        locale: 'es',
        status: 'draft',
        previousVersionId: current?.document_version_id,
      })
      const note = await create(Notes, {
        ...complete('Ver Note EN', 'Ver Note ES', 'ver-note'),
        topic: { targetDocumentId: topic, targetCollectionId: ids[Topics.path] },
      })
      const viaTopic = (value: string) => hop('topic', Topics.path, [titleIs(value)])

      // The published target is incomplete in Spanish: its source shows.
      expect((await find(Notes, { filters: [viaTopic('Ver Topic ES')] })).ids).not.toContain(note)
      expect((await find(Notes, { filters: [viaTopic('Ver Topic EN')] })).ids).toContain(note)
      // The latest (draft) target is complete in Spanish.
      expect(
        (
          await find(Notes, {
            filters: [viaTopic('Ver Topic ES')],
            readMode: 'any',
            localeVisibility: 'editorial',
          })
        ).ids
      ).toContain(note)
    })

    // --- Q2: ties and several withheld values --------------------------------

    it('sort ties and withheld values order consistently in both directions and across pages', async () => {
      // Public fallback shows: C 'Same' (withheld 'Zeta'), D 'Same' (checked),
      // E 'Alpha', F 'Beta' (both withheld Spanish).
      const c = await create(Topics, complete('Same', 'Zeta', 'q2t'))
      const d = await create(Topics, complete('Other', 'Same', 'q2t'))
      const e = await create(Topics, complete('Alpha', 'Alpha ES', 'q2t'))
      const f = await create(Topics, complete('Beta', 'Beta ES', 'q2t'))
      await check(Topics, d, ['es'])
      const set = [skuIs('q2t')]

      // Ties fall back to creation order in the sort direction.
      expect((await find(Topics, { filters: set, sort: byTitle('asc') })).ids).toEqual([e, f, c, d])
      expect((await find(Topics, { filters: set, sort: byTitle('desc') })).ids).toEqual([
        d,
        c,
        f,
        e,
      ])
      const page1 = await find(Topics, { filters: set, sort: byTitle('asc'), pageSize: 3, page: 1 })
      const page2 = await find(Topics, { filters: set, sort: byTitle('asc'), pageSize: 3, page: 2 })
      expect(page1.ids).toEqual([e, f, c])
      expect(page2.ids).toEqual([d])
      expect(page1.total).toBe(4)

      // Public exact: only D has an eligible Spanish value; the three withheld
      // rows have none and sort last in both directions.
      const exact = { filters: set, onMissingLocale: 'empty' as const }
      expect((await find(Topics, { ...exact, sort: byTitle('asc') })).ids).toEqual([d, c, e, f])
      expect((await find(Topics, { ...exact, sort: byTitle('desc') })).ids).toEqual([d, f, e, c])

      // Editorial sees every Spanish value.
      expect(
        (await find(Topics, { filters: set, sort: byTitle('asc'), localeVisibility: 'editorial' }))
          .ids
      ).toEqual([e, f, d, c])
    })

    // --- trees: structural predicates use the hydration locale ----------------

    describe('tree structural reads', () => {
      const englishTitles: FieldFilter = {
        kind: 'field',
        fieldName: 'title',
        storeType: 'text',
        valueColumn: 'value',
        operator: '$in',
        value: ['Tree Root EN', 'Tree Child EN', 'Tree Grand EN'],
      }
      const spanishTitles: FieldFilter = {
        ...englishTitles,
        value: ['Tree Root ES', 'Tree Child ES', 'Tree Grand ES'],
      }
      let root: string
      let child: string
      let grand: string

      beforeAll(async () => {
        const topic = await create(Topics, complete('Tree Topic EN', 'Tree Topic ES', 'tree-topic'))
        root = await create(Nodes, complete('Tree Root EN', 'Tree Root ES', 'tree'))
        child = await create(Nodes, complete('Tree Child EN', 'Tree Child ES', 'tree'))
        grand = await create(Nodes, {
          ...complete('Tree Grand EN', 'Tree Grand ES', 'tree'),
          topic: { targetDocumentId: topic, targetCollectionId: ids[Topics.path] },
        })
        const place = (documentId: string, parentDocumentId: string | null) =>
          adapter.commands.documents.placeTreeNode({
            collectionId: ids[Nodes.path] as string,
            documentId,
            parentDocumentId,
          })
        await place(root, null)
        await place(child, root)
        await place(grand, child)
      })

      const subtree = (filters: DocumentFilter[], localeVisibility?: LocaleVisibility) =>
        adapter.queries.documents
          .getTreeSubtree({
            collectionId: ids[Nodes.path] as string,
            rootDocumentId: root,
            readMode: 'published',
            locale: 'es',
            filters,
            localeVisibility,
          })
          .then((rows) => rows.map((r) => r.document_id))

      it('public subtree predicates match the shown source; editorial matches Spanish', async () => {
        expect(await subtree([englishTitles], 'public')).toEqual([root, child, grand])
        expect(await subtree([spanishTitles], 'public')).toEqual([])
        expect(await subtree([spanishTitles], 'editorial')).toEqual([root, child, grand])
        expect(await subtree([englishTitles], 'editorial')).toEqual([])
        // Editing reads (no visibility) keep exact requested-locale matching.
        expect(await subtree([spanishTitles])).toEqual([root, child, grand])
      })

      it('public ancestors and parent-only lookups use the same policy', async () => {
        const ancestors = (filters: DocumentFilter[], localeVisibility: LocaleVisibility) =>
          adapter.queries.documents
            .getTreeAncestors({
              document_id: grand,
              readMode: 'published',
              locale: 'es',
              filters,
              localeVisibility,
            })
            .then((rows) => rows.map((r) => r.document_id).sort())
        expect(await ancestors([englishTitles], 'public')).toEqual([root, child].sort())
        expect(await ancestors([spanishTitles], 'public')).toEqual([])
        expect(await ancestors([spanishTitles], 'editorial')).toEqual([root, child].sort())

        const parent = (filters: DocumentFilter[], localeVisibility: LocaleVisibility) =>
          adapter.queries.documents.getTreeParent({
            document_id: child,
            readMode: 'published',
            locale: 'es',
            filters,
            localeVisibility,
          })
        expect((await parent([englishTitles], 'public')).parentDocumentId).toBe(root)
        expect((await parent([spanishTitles], 'public')).parentDocumentId).toBeNull()
        expect((await parent([spanishTitles], 'editorial')).parentDocumentId).toBe(root)
      })

      it("nested predicates evaluate a node's relation target under its own policy", async () => {
        const nested = (topicTitle: string): DocumentFilter => ({
          kind: 'or',
          children: [
            { ...englishTitles, value: ['Tree Root EN', 'Tree Child EN'] },
            hop('topic', Topics.path, [titleIs(topicTitle)]),
          ],
        })
        expect(await subtree([nested('Tree Topic EN')], 'public')).toEqual([root, child, grand])
        // The grandchild's topic is unchecked in Spanish, so it cannot match.
        expect(await subtree([nested('Tree Topic ES')], 'public')).toEqual([root, child])
      })
    })
  })
}
