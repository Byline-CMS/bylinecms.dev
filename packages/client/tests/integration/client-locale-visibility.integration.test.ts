/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end propagation of locale visibility through the client read
 * pipeline: direct reads, relation populate, rich-text reads, tree hydration,
 * history, shared read contexts, and the save-time rich-text embed.
 *
 * Spanish is complete but unchecked on every advertised document unless a test
 * checks it. Public reads must therefore fall back to English; editorial reads
 * (`status: 'any'`, or an explicit `localeVisibility: 'editorial'`) may show
 * Spanish. Each populated target resolves under its own collection and
 * checkbox set.
 */

import { createRequestContext } from '@byline/auth'
import type { CollectionDefinition, RichTextEmbedFn, RichTextPopulateFn } from '@byline/core'
import { createReadContext } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createBylineClient } from '../../src/index.js'
import {
  type MultiCollectionTestContext,
  setupMultiCollectionTestClient,
} from '../fixtures/setup.js'

const suffix = `${Date.now()}-vis-${Math.floor(Math.random() * 1e6)}`

const richTextFields: CollectionDefinition['fields'] = [
  { name: 'title', type: 'text', localized: true, optional: true },
  { name: 'body', type: 'richText', localized: true, optional: true },
]

const Topics: CollectionDefinition = {
  path: `test-vis-topics-${suffix}`,
  labels: { singular: 'Topic', plural: 'Topics' },
  useAsTitle: 'title',
  advertiseLocales: true,
  fields: richTextFields,
}

const Tags: CollectionDefinition = {
  path: `test-vis-tags-${suffix}`,
  labels: { singular: 'Tag', plural: 'Tags' },
  useAsTitle: 'title',
  fields: [
    ...richTextFields,
    { name: 'topic', type: 'relation', targetCollection: Topics.path, optional: true },
  ],
}

const Notes: CollectionDefinition = {
  path: `test-vis-notes-${suffix}`,
  labels: { singular: 'Note', plural: 'Notes' },
  useAsTitle: 'title',
  advertiseLocales: true,
  fields: [
    ...richTextFields,
    { name: 'topic', type: 'relation', targetCollection: Topics.path, optional: true },
    { name: 'tag', type: 'relation', targetCollection: Tags.path, optional: true },
    {
      name: 'live',
      type: 'richText',
      optional: true,
      embedRelationsOnSave: false,
      populateRelationsOnRead: true,
    },
    {
      name: 'snapshot',
      type: 'richText',
      optional: true,
      embedRelationsOnSave: true,
      populateRelationsOnRead: false,
    },
  ],
}

const Nodes: CollectionDefinition = {
  path: `test-vis-nodes-${suffix}`,
  labels: { singular: 'Node', plural: 'Nodes' },
  useAsTitle: 'title',
  advertiseLocales: true,
  tree: true,
  fields: richTextFields,
}

const Pages: CollectionDefinition = {
  path: `test-vis-pages-${suffix}`,
  labels: { singular: 'Page', plural: 'Pages' },
  useAsTitle: 'title',
  advertiseLocales: true,
  fields: [
    ...richTextFields,
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
  ],
}

// A tree whose beforeRead predicate matches localized English titles, so the
// structural queries must evaluate it in the locale hydration shows.
const GatedNodes: CollectionDefinition = {
  path: `test-vis-gated-${suffix}`,
  labels: { singular: 'Gated', plural: 'Gated' },
  useAsTitle: 'title',
  advertiseLocales: true,
  tree: true,
  fields: richTextFields,
  hooks: {
    beforeRead: () => ({ title: { $in: ['G Root EN', 'G Child EN'] } }),
  },
}

const rt = (text: string) => ({ root: { type: 'root', children: [{ type: 'text', text }] } })

const linkTo = (collectionPath: string, documentId: string) => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'link',
        attributes: {
          linkType: 'internal',
          targetCollectionPath: collectionPath,
          targetDocumentId: documentId,
        },
        children: [{ type: 'text', text: 'authored link text' }],
      },
    ],
  },
})

/** Copies the target's title into each internal link's `attributes.document`. */
async function refreshLinks(
  value: unknown,
  readDocuments: Parameters<RichTextPopulateFn>[0]['readDocuments']
): Promise<void> {
  const root = (value as { root?: Record<string, any> } | null)?.root
  if (root == null) return
  const links: Array<Record<string, any>> = []
  const walk = (node: any) => {
    if (node == null || typeof node !== 'object') return
    if (node.type === 'link' && node.attributes?.linkType === 'internal') links.push(node)
    if (Array.isArray(node.children)) for (const child of node.children) walk(child)
  }
  walk(root)
  for (const node of links) {
    const { targetCollectionPath, targetDocumentId } = node.attributes
    const [row] = await readDocuments({
      collectionPath: targetCollectionPath,
      documentIds: [targetDocumentId],
    })
    node.attributes.document = { title: row?.fields?.title ?? null }
  }
}

const richTextPopulate: RichTextPopulateFn = ({ value, readDocuments }) =>
  refreshLinks(value, readDocuments)
const richTextEmbed: RichTextEmbedFn = ({ value, readDocuments }) =>
  refreshLinks(value, readDocuments)

let ctx: MultiCollectionTestContext
const id = {} as {
  topic: string
  tag: string
  note: string
  root: string
  child: string
  pageUnchecked: string
  pageChecked: string
  pagePartialDe: string
  agnosticTopic: string
  agnosticNote: string
  agnosticNode: string
  gatedRoot: string
  gatedChild: string
  q4: string[]
}

function collectionId(def: CollectionDefinition): string {
  return ctx.collectionIds[def.path] as string
}

async function seed(
  def: CollectionDefinition,
  data: Record<string, unknown>,
  path: string
): Promise<string> {
  const result = await ctx.db.commands.documents.createDocumentVersion({
    collectionId: collectionId(def),
    collectionVersion: 1,
    collectionConfig: def,
    action: 'create',
    documentData: data,
    path: `${path}-${suffix}`,
    locale: 'all',
    status: 'published',
  })
  return result.document.document_id as string
}

function check(def: CollectionDefinition, documentId: string, locales: string[]) {
  return ctx.db.commands.documents.setDocumentAvailableLocales({
    documentId,
    collectionId: collectionId(def),
    availableLocales: locales,
  })
}

beforeAll(async () => {
  ctx = await setupMultiCollectionTestClient([Topics, Tags, Notes, Nodes, Pages, GatedNodes], {
    richTextPopulate,
    richTextEmbed,
  })

  id.topic = await seed(
    Topics,
    { title: { en: 'Topic EN', es: 'Topic ES' }, body: { en: rt('b'), es: rt('b') } },
    'topic'
  )
  id.tag = await seed(
    Tags,
    {
      title: { en: 'Tag EN', es: 'Tag ES' },
      body: { en: rt('b'), es: rt('b') },
      topic: { targetDocumentId: id.topic, targetCollectionId: collectionId(Topics) },
    },
    'tag'
  )
  id.note = await seed(
    Notes,
    {
      title: { en: 'Note EN', es: 'Note ES' },
      body: { en: rt('b'), es: rt('b') },
      topic: { targetDocumentId: id.topic, targetCollectionId: collectionId(Topics) },
      tag: { targetDocumentId: id.tag, targetCollectionId: collectionId(Tags) },
      live: linkTo(Topics.path, id.topic),
    },
    'note'
  )
  await check(Notes, id.note, ['es'])

  id.root = await seed(
    Nodes,
    { title: { en: 'Root EN', es: 'Root ES' }, body: { en: rt('b'), es: rt('b') } },
    'root'
  )
  id.child = await seed(
    Nodes,
    { title: { en: 'Child EN', es: 'Child ES' }, body: { en: rt('b'), es: rt('b') } },
    'child'
  )
  await ctx.client
    .collection(Nodes.path)
    .placeTreeNode(id.root, { parentDocumentId: null, expectedRevision: 1 })
  await ctx.client
    .collection(Nodes.path)
    .placeTreeNode(id.child, { parentDocumentId: id.root, expectedRevision: 1 })

  // Pages: Spanish complete; German translates only the title.
  const page = (prefix: string) => ({
    title: { en: `${prefix} EN`, es: `${prefix} ES`, de: `${prefix} DE` },
    body: { en: rt('b'), es: rt('b') },
    sku: `${prefix}-sku`,
    sections: [
      { heading: { en: 'One EN', es: 'One ES' }, code: 'A' },
      { heading: { en: 'Two EN', es: 'Two ES' }, code: 'B' },
    ],
  })
  id.pageUnchecked = await seed(Pages, page('PU'), 'page-unchecked')
  id.pageChecked = await seed(Pages, page('PC'), 'page-checked')
  await check(Pages, id.pageChecked, ['es'])
  id.pagePartialDe = await seed(Pages, page('PD'), 'page-partial-de')
  await check(Pages, id.pagePartialDe, ['de'])

  // Locale-agnostic documents: no localized values at all.
  id.agnosticTopic = await seed(Topics, {}, 'agnostic-topic')
  id.agnosticNote = await seed(
    Notes,
    { topic: { targetDocumentId: id.agnosticTopic, targetCollectionId: collectionId(Topics) } },
    'agnostic-note'
  )
  id.agnosticNode = await seed(Nodes, {}, 'agnostic-node')
  await ctx.client
    .collection(Nodes.path)
    .placeTreeNode(id.agnosticNode, { parentDocumentId: id.root, expectedRevision: 1 })

  id.gatedRoot = await seed(
    GatedNodes,
    { title: { en: 'G Root EN', es: 'G Root ES' }, body: { en: rt('b'), es: rt('b') } },
    'gated-root'
  )
  id.gatedChild = await seed(
    GatedNodes,
    { title: { en: 'G Child EN', es: 'G Child ES' }, body: { en: rt('b'), es: rt('b') } },
    'gated-child'
  )
  await ctx.client
    .collection(GatedNodes.path)
    .placeTreeNode(id.gatedRoot, { parentDocumentId: null, expectedRevision: 1 })
  await ctx.client
    .collection(GatedNodes.path)
    .placeTreeNode(id.gatedChild, { parentDocumentId: id.gatedRoot, expectedRevision: 1 })

  // Q4: three pages checked in Spanish and one unchecked, sharing one sku.
  id.q4 = []
  for (const [index, letter] of ['C', 'A', 'B', 'D'].entries()) {
    const docId = await seed(
      Pages,
      {
        title: { en: `Q4 ${letter} EN`, es: `Q4 ${letter} ES` },
        body: { en: rt('b'), es: rt('b') },
        sku: 'q4sdk',
      },
      `q4-${index}`
    )
    if (letter !== 'D') await check(Pages, docId, ['es'])
    id.q4.push(docId)
  }
}, 60_000)

afterAll(async () => {
  for (const def of [Notes, Tags, Topics, Nodes, Pages, GatedNodes]) {
    try {
      await ctx.db.commands.collections.delete(collectionId(def))
    } catch (err) {
      console.error('Failed to clean up test collection:', err)
    }
  }
})

type Envelope = { document?: { fields: Record<string, any>; resolvedLocale?: string | null } }

describe('direct reads', () => {
  it('a public read falls back for a complete but unchecked translation', async () => {
    const doc = await ctx.client.collection(Topics.path).findById(id.topic, { locale: 'es' })
    expect(doc?.fields.title).toBe('Topic EN')
    expect(doc?.resolvedLocale).toBe('en')
  })

  it('an authorized published editorial read shows it, with no draft involved', async () => {
    const doc = await ctx.client
      .collection(Topics.path)
      .findById(id.topic, { locale: 'es', status: 'published', localeVisibility: 'editorial' })
    expect(doc?.status).toBe('published')
    expect(doc?.fields.title).toBe('Topic ES')
    expect(doc?.resolvedLocale).toBe('es')
  })

  it('status any is editorial by default', async () => {
    const doc = await ctx.client
      .collection(Topics.path)
      .findById(id.topic, { locale: 'es', status: 'any' })
    expect(doc?.fields.title).toBe('Topic ES')
  })

  it('an anonymous public read falls back too', async () => {
    const anonymous = createBylineClient({
      db: ctx.db,
      collections: [Topics, Tags, Notes, Nodes, Pages, GatedNodes],
      requestContext: createRequestContext({ actor: null, readMode: 'published' }),
    })
    const { docs } = await anonymous.collection(Topics.path).find({ locale: 'es' })
    const doc = docs.find((d) => d.id === id.topic)
    expect(doc?.fields.title).toBe('Topic EN')
    expect(doc?.resolvedLocale).toBe('en')
  })
})

describe('relation populate', () => {
  it("a parent's checked locale does not authorize its target", async () => {
    const note = await ctx.client
      .collection(Notes.path)
      .findById(id.note, { locale: 'es', populate: { topic: '*', tag: '*' } })
    expect(note?.fields.title, 'the note itself is checked in Spanish').toBe('Note ES')
    expect(note?.resolvedLocale).toBe('es')
    const topic = note?.fields.topic as Envelope
    expect(topic.document?.fields.title).toBe('Topic EN')
    expect(topic.document?.resolvedLocale).toBe('en')
    // A target in a collection without advertiseLocales needs no checkbox.
    const tag = note?.fields.tag as Envelope
    expect(tag.document?.fields.title).toBe('Tag ES')
    expect(tag.document?.resolvedLocale).toBe('es')
  })

  it('a non-advertised parent still gates its advertised target', async () => {
    const tag = await ctx.client
      .collection(Tags.path)
      .findById(id.tag, { locale: 'es', populate: { topic: '*' } })
    expect(tag?.fields.title).toBe('Tag ES')
    expect((tag?.fields.topic as Envelope | undefined)?.document?.fields.title).toBe('Topic EN')
  })

  it('editorial visibility reaches populated targets', async () => {
    const note = await ctx.client.collection(Notes.path).findById(id.note, {
      locale: 'es',
      status: 'published',
      localeVisibility: 'editorial',
      populate: { topic: '*' },
    })
    expect((note?.fields.topic as Envelope | undefined)?.document?.fields.title).toBe('Topic ES')
  })
})

describe('rich-text read-time population', () => {
  const liveTitle = (doc: any) => doc?.fields.live?.root?.children?.[0]?.attributes?.document?.title

  it('a public read refreshes a live link under public visibility', async () => {
    const note = await ctx.client.collection(Notes.path).findById(id.note, { locale: 'es' })
    expect(liveTitle(note)).toBe('Topic EN')
  })

  it('an editorial read refreshes it under editorial visibility', async () => {
    const note = await ctx.client
      .collection(Notes.path)
      .findById(id.note, { locale: 'es', status: 'published', localeVisibility: 'editorial' })
    expect(liveTitle(note)).toBe('Topic ES')
  })

  it.each([
    ['editorial then public', ['editorial', 'public'] as const],
    ['public then editorial', ['public', 'editorial'] as const],
  ])(
    'a shared read context never reuses a result across visibilities (%s)',
    async (_name, order) => {
      const readContext = createReadContext()
      const expected = { public: 'Topic EN', editorial: 'Topic ES' }
      for (const [index, visibility] of order.entries()) {
        const note = await ctx.client.collection(Notes.path).findById(id.note, {
          locale: 'es',
          status: 'published',
          localeVisibility: visibility,
          populate: { topic: '*' },
          _readContext: readContext,
        })
        // The rich-text reader keys its cache by visibility, so each read
        // refreshes the live link under its own policy.
        expect(liveTitle(note)).toBe(expected[visibility])
        const topic = note?.fields.topic as Envelope & { _cycle?: true }
        if (index === 0) {
          expect(topic.document?.fields.title).toBe(expected[visibility])
        } else {
          // A relation already expanded in this read context becomes a cycle
          // stub: it carries no document, so no earlier result is reused.
          expect(topic._cycle).toBe(true)
          expect(topic.document).toBeUndefined()
        }
      }
    }
  )
})

describe('read-time refresh changes only the response', () => {
  it('reads never mint a parent version', async () => {
    // Every read above refreshed the note's live link; none may persist.
    const history = await ctx.client.collection(Notes.path).history(id.note, { locale: 'en' })
    expect(history.meta.total).toBe(1)
  })
})

describe('tree hydration', () => {
  it('public subtree and ancestors fall back per node without breaking the spine', async () => {
    const tree = await ctx.client.collection(Nodes.path).getSubtree({ locale: 'es' })
    const root = tree.find((n) => n.document.id === id.root)
    expect(root?.document.fields.title).toBe('Root EN')
    expect(root?.document.resolvedLocale).toBe('en')
    expect(root?.children[0]?.document.fields.title).toBe('Child EN')

    const ancestors = await ctx.client
      .collection(Nodes.path)
      .getAncestors(id.child, { locale: 'es' })
    expect(ancestors.map((a) => a.fields.title)).toEqual(['Root EN'])
  })

  it('editorial subtree shows the unchecked translations', async () => {
    const tree = await ctx.client
      .collection(Nodes.path)
      .getSubtree({ locale: 'es', status: 'published', localeVisibility: 'editorial' })
    expect(tree.find((n) => n.document.id === id.root)?.document.fields.title).toBe('Root ES')
  })
})

describe('history and version reads', () => {
  it('are editorial exact reads that report the requested locale', async () => {
    const history = await ctx.client.collection(Topics.path).history(id.topic, { locale: 'es' })
    expect(history.docs[0]?.fields.title).toBe('Topic ES')
    expect(history.docs[0]?.resolvedLocale).toBe('es')

    const versionId = history.docs[0]?.versionId as string
    const version = await ctx.client.collection(Topics.path).findByVersion(versionId, {
      locale: 'es',
    })
    expect(version?.resolvedLocale).toBe('es')
  })
})

describe('resolvedLocale result types through SDK shaping', () => {
  const pages = () => ctx.client.collection(Pages.path)

  it('R2: omit excludes an unchecked translation and returns a checked one', async () => {
    expect(
      await pages().findById(id.pageUnchecked, { locale: 'es', onMissingLocale: 'omit' })
    ).toBeNull()
    const { docs } = await pages().find({ locale: 'es', onMissingLocale: 'omit', pageSize: 50 })
    expect(docs.some((d) => d.id === id.pageUnchecked)).toBe(false)

    const checked = await pages().findById(id.pageChecked, {
      locale: 'es',
      onMissingLocale: 'omit',
    })
    expect(checked?.fields.title).toBe('PC ES')
    expect(checked?.resolvedLocale).toBe('es')
    expect(docs.some((d) => d.id === id.pageChecked)).toBe(true)
  })

  it('R3: public empty returns an eligible locale exactly', async () => {
    const doc = await pages().findById(id.pageChecked, { locale: 'es', onMissingLocale: 'empty' })
    expect(doc?.fields.title).toBe('PC ES')
    expect(doc?.resolvedLocale).toBe('es')
  })

  it('R4: public empty withholds a complete but unchecked translation, nested values included', async () => {
    const doc = await pages().findById(id.pageUnchecked, { locale: 'es', onMissingLocale: 'empty' })
    expect(doc?.resolvedLocale).toBeNull()
    expect(doc?.fields.title).toBeUndefined()
    expect(doc?.fields.body).toBeUndefined()
    expect(doc?.fields.sku, 'non-localized top-level value kept').toBe('PU-sku')
    const sections = doc?.fields.sections as Array<Record<string, any>>
    expect(
      sections.map((item) => item.code),
      'non-localized nested values kept'
    ).toEqual(['A', 'B'])
    expect(sections.map((item) => item.heading)).toEqual([undefined, undefined])
    expect(sections.every((item) => typeof item._id === 'string')).toBe(true)
  })

  it('R4: public empty withholds a checked but incomplete translation', async () => {
    const doc = await pages().findById(id.pagePartialDe, { locale: 'de', onMissingLocale: 'empty' })
    expect(doc?.resolvedLocale).toBeNull()
    expect(doc?.fields.title).toBeUndefined()
    expect(doc?.fields.sku).toBe('PD-sku')
  })

  it('R5: editorial empty returns partial and entirely absent requested values exactly', async () => {
    const partial = await pages().findById(id.pagePartialDe, {
      locale: 'de',
      onMissingLocale: 'empty',
      status: 'any',
    })
    expect(partial?.resolvedLocale).toBe('de')
    expect(partial?.fields.title).toBe('PD DE')
    expect(partial?.fields.body).toBeUndefined()

    const absent = await pages().findById(id.pageUnchecked, {
      locale: 'fr',
      onMissingLocale: 'empty',
      status: 'any',
    })
    expect(absent?.resolvedLocale).toBe('fr')
    expect(absent?.fields.title).toBeUndefined()
    expect(absent?.fields.sku).toBe('PU-sku')
  })

  it('R6: an authorized multi-locale read reports null with locale maps', async () => {
    const doc = await pages().findById(id.pageUnchecked, { locale: 'all', status: 'any' })
    expect(doc?.resolvedLocale).toBeNull()
    expect(doc?._localeAgnostic).toBe(false)
    expect(doc?.fields.title).toMatchObject({ en: 'PU EN', es: 'PU ES' })
  })

  it('R7: a locale-agnostic document reports null and _localeAgnostic on every surface', async () => {
    const direct = await ctx.client
      .collection(Topics.path)
      .findById(id.agnosticTopic, { locale: 'es' })
    expect(direct?.resolvedLocale).toBeNull()
    expect(direct?._localeAgnostic).toBe(true)

    const note = await ctx.client
      .collection(Notes.path)
      .findById(id.agnosticNote, { locale: 'es', populate: { topic: '*' } })
    const target = (
      note?.fields.topic as (Envelope & { document?: { _localeAgnostic?: boolean } }) | undefined
    )?.document
    expect(target?.resolvedLocale, 'populated target').toBeNull()
    expect(target?._localeAgnostic).toBe(true)

    const tree = await ctx.client.collection(Nodes.path).getSubtree({ locale: 'es' })
    const node = tree
      .flatMap((n) => [n, ...n.children])
      .find((n) => n.document.id === id.agnosticNode)
    expect(node?.document.resolvedLocale, 'tree node').toBeNull()
    expect(node?.document._localeAgnostic).toBe(true)

    const history = await ctx.client
      .collection(Topics.path)
      .history(id.agnosticTopic, { locale: 'es' })
    expect(history.docs[0]?.resolvedLocale, 'history').toBeNull()
    expect(history.docs[0]?._localeAgnostic).toBe(true)

    const version = await ctx.client
      .collection(Topics.path)
      .findByVersion(history.docs[0]?.versionId as string, { locale: 'es' })
    expect(version?.resolvedLocale, 'version').toBeNull()
    expect(version?._localeAgnostic).toBe(true)
  })
})

describe('tree structural reads receive the visibility (SDK)', () => {
  const gated = () => ctx.client.collection(GatedNodes.path)

  it('a public subtree admits nodes whose shown source matches beforeRead', async () => {
    const tree = await gated().getSubtree({ locale: 'es' })
    expect(tree.map((n) => n.document.id)).toEqual([id.gatedRoot])
    expect(tree[0]?.children.map((n) => n.document.id)).toEqual([id.gatedChild])
    expect(tree[0]?.document.fields.title).toBe('G Root EN')
  })

  it('published editorial evaluates the same predicate against the unchecked Spanish', async () => {
    const tree = await gated().getSubtree({
      locale: 'es',
      status: 'published',
      localeVisibility: 'editorial',
    })
    expect(tree).toEqual([])
  })

  it('ancestors and the structure-only parent lookup follow the same policy', async () => {
    const ancestors = await gated().getAncestors(id.gatedChild, { locale: 'es' })
    expect(ancestors.map((a) => a.id)).toEqual([id.gatedRoot])
    const parent = await gated().getTreeParent(id.gatedChild, { locale: 'es' })
    expect(parent.parentDocumentId).toBe(id.gatedRoot)

    const editorialParent = await gated().getTreeParent(id.gatedChild, {
      locale: 'es',
      status: 'published',
      localeVisibility: 'editorial',
    })
    expect(editorialParent.parentDocumentId).toBeNull()
  })
})

describe('public omit pagination through the SDK (Q4)', () => {
  it('ids, order, total, totalPages and successive pages agree; projection changes nothing', async () => {
    const [c, a, b] = id.q4 as [string, string, string, string]
    const read = (page: number, select?: string[]) =>
      ctx.client.collection(Pages.path).find({
        locale: 'es',
        onMissingLocale: 'omit',
        where: { sku: 'q4sdk' },
        sort: { title: 'asc' },
        pageSize: 2,
        page,
        ...(select ? { select } : {}),
      })

    const page1 = await read(1)
    const page2 = await read(2)
    expect(page1.docs.map((d) => d.id)).toEqual([a, b])
    expect(page2.docs.map((d) => d.id)).toEqual([c])
    expect(page1.meta).toMatchObject({ total: 3, totalPages: 2, page: 1, pageSize: 2 })
    expect(page2.meta).toMatchObject({ total: 3, totalPages: 2, page: 2 })
    expect([...page1.docs, ...page2.docs].map((d) => [d.fields.title, d.resolvedLocale])).toEqual([
      ['Q4 A ES', 'es'],
      ['Q4 B ES', 'es'],
      ['Q4 C ES', 'es'],
    ])

    const projected1 = await read(1, ['title'])
    const projected2 = await read(2, ['title'])
    expect(projected1.docs.map((d) => d.id)).toEqual(page1.docs.map((d) => d.id))
    expect(projected2.docs.map((d) => d.id)).toEqual(page2.docs.map((d) => d.id))
    expect(projected1.meta).toEqual(page1.meta)
    expect(projected1.docs.map((d) => d.resolvedLocale)).toEqual(['es', 'es'])
  })
})

describe('save-time rich-text embed (F3)', () => {
  it('an authenticated save embeds only publicly eligible target values', async () => {
    // A French-source target: the lifecycle default is English, and the
    // English translation is complete but unchecked.
    const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING as string
    const frenchAuthoring = pgAdapter({
      connectionString,
      collections: [Topics, Tags, Notes, Nodes, Pages, GatedNodes],
      defaultContentLocale: 'fr',
    })
    const created = await frenchAuthoring.commands.documents.createDocumentVersion({
      collectionId: collectionId(Topics),
      collectionVersion: 1,
      collectionConfig: Topics,
      action: 'create',
      documentData: {
        title: { fr: 'Cible FR', en: 'Target EN' },
        body: { fr: rt('b'), en: rt('b') },
      },
      path: `target-fr-${suffix}`,
      locale: 'all',
      status: 'published',
    })
    const targetId = created.document.document_id as string
    const target = await ctx.client
      .collection(Topics.path)
      .findById(targetId, { locale: 'en', status: 'any' })
    expect(target?.sourceLocale).toBe('fr')

    // The fixture's client is authenticated as a super-admin editor.
    const saved = await ctx.client
      .collection(Notes.path)
      .create({ title: 'Embed EN', snapshot: linkTo(Topics.path, targetId) }, { locale: 'en' })
    const stored = await ctx.client
      .collection(Notes.path)
      .findById(saved.documentId, { locale: 'en', status: 'any' })
    const snapshotTitle = (stored?.fields.snapshot as any)?.root?.children?.[0]?.attributes
      ?.document?.title
    expect(snapshotTitle, 'the withheld English translation was not copied').toBe('Cible FR')

    // Snapshot-only fields keep their saved copy: releasing English later does
    // not rewrite or refresh the stored snapshot.
    await check(Topics, targetId, ['en'])
    const reread = await ctx.client
      .collection(Notes.path)
      .findById(saved.documentId, { locale: 'en', status: 'any' })
    expect((reread?.fields.snapshot as any)?.root?.children?.[0]?.attributes?.document?.title).toBe(
      'Cible FR'
    )
    const saves = await ctx.client
      .collection(Notes.path)
      .history(saved.documentId, { locale: 'en' })
    expect(saves.meta.total, 'only the create wrote a version').toBe(1)
  })
})
