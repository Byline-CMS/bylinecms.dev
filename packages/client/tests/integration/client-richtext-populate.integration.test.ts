/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end verification of the read-time richtext populate primitive
 * (`populateRichTextFields`) for relation envelopes embedded *inside a
 * `blocks` field*. Closes the item deferred when the populate primitive
 * landed.
 *
 * The unit suites already cover the leaf walk and per-leaf gating in
 * isolation (`richtext-populate.test.node.ts`) and the Lexical link
 * visitor's refresh branches (`link/populate.test.node.ts`). This file
 * closes the integration gap: a real document with two richText leaves
 * nested in a block — one storage-thin (`populateRelationsOnRead: true`),
 * one snapshot (`populateRelationsOnRead: false`) — each holding an
 * internal-link envelope to the same target. Mutating and re-publishing
 * the target, then re-reading the page, must:
 *
 *   - refresh the embedded title on the `populateRelationsOnRead: true`
 *     leaf (read-time populate fires), and
 *   - leave the embedded title stale on the `false` leaf (read-time
 *     populate is skipped — the persisted snapshot is served as-is).
 *
 * The populate adapter is wired inline (a minimal internal-link title
 * refresher) rather than importing `@byline/richtext-lexical/server`,
 * because that package depends on `@byline/client` — importing it here
 * would create a dev dependency cycle. The framework contract under test
 * (which leaves get walked, gated by their effective
 * `populateRelationsOnRead`) is editor-agnostic, so a stand-in visitor
 * exercises exactly the same `populateRichTextFields` path the real
 * adapter rides on. `runLexicalPopulate` fetches targets with
 * `readMode: 'published'`, so the inline adapter mirrors that — hence the
 * target is re-published after the mutation.
 *
 * Needs two collections (pages → articles), so it wires the client via the
 * same multi-collection fixture as `client-populate-status`.
 */

import { createSuperAdminContext } from '@byline/auth'
import type { IDbAdapter, RichTextPopulateFn } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupMultiCollectionTestClient } from '../fixtures/setup.js'
import type { BylineClient } from '../../src/index.js'

const superAdmin = createSuperAdminContext({ id: 'test-super-admin' })

const suffix = `${Date.now()}-rt-pop-${Math.floor(Math.random() * 1e6)}`

const articlesDefinition = defineCollection({
  path: `test-articles-${suffix}`,
  labels: { singular: 'Article', plural: 'Articles' },
  useAsPath: 'title',
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
})

const pagesDefinition = defineCollection({
  path: `test-pages-${suffix}`,
  labels: { singular: 'Page', plural: 'Pages' },
  useAsPath: 'title',
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    {
      name: 'content',
      type: 'blocks',
      label: 'Content',
      optional: true,
      blocks: [
        {
          blockType: 'linkBlock',
          label: 'Link Block',
          fields: [
            // Storage-thin: refreshed on every read.
            {
              name: 'bodyPopulated',
              type: 'richText',
              label: 'Body (populated)',
              optional: true,
              embedRelationsOnSave: false,
              populateRelationsOnRead: true,
            },
            // Snapshot: persisted as embedded, never refreshed on read.
            {
              name: 'bodySnapshot',
              type: 'richText',
              label: 'Body (snapshot)',
              optional: true,
              embedRelationsOnSave: true,
              populateRelationsOnRead: false,
            },
          ],
        },
      ],
    },
  ],
})

// ---------------------------------------------------------------------------
// Inline richtext populate adapter — refreshes `attributes.document.title`
// on internal-link nodes from the (published) target document. Mirrors the
// shape of `@byline/richtext-lexical`'s `linkVisitor` without importing it.
// ---------------------------------------------------------------------------

const richTextPopulate: RichTextPopulateFn = async ({ value, readDocuments }) => {
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
    const attrs = node.attributes as Record<string, any>
    const targetPath = attrs.targetCollectionPath as string | undefined
    const targetId = attrs.targetDocumentId as string | undefined
    if (!targetPath || !targetId) continue

    const rows = await readDocuments({ collectionPath: targetPath, documentIds: [targetId] })

    const title = (rows[0]?.fields as Record<string, any> | undefined)?.title
    attrs.document = {
      ...(attrs.document ?? {}),
      ...(typeof title === 'string' ? { title } : {}),
    }
  }
}

// ---------------------------------------------------------------------------
// Lexical helpers — build a single internal-link paragraph and read the
// embedded title back out of a (possibly populated) richText value.
// ---------------------------------------------------------------------------

const makeLinkValue = (targetPath: string, targetId: string, embeddedTitle: string) => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            attributes: {
              linkType: 'internal',
              targetCollectionPath: targetPath,
              targetDocumentId: targetId,
              document: { title: embeddedTitle },
            },
            children: [{ type: 'text', text: 'see the article' }],
          },
        ],
      },
    ],
  },
})

function embeddedLinkTitle(richTextValue: unknown): string | undefined {
  let found: string | undefined
  const walk = (node: any) => {
    if (node == null || typeof node !== 'object') return
    if (node.type === 'link' && node.attributes?.linkType === 'internal') {
      found = node.attributes.document?.title
    }
    if (Array.isArray(node.children)) for (const child of node.children) walk(child)
  }
  walk((richTextValue as { root?: unknown } | null)?.root)
  return found
}

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  articlesCollectionId: string
  pagesCollectionId: string
}

interface PageFields {
  title: string
  content?: Array<{
    _id?: string
    _type?: string
    bodyPopulated?: unknown
    bodySnapshot?: unknown
  }>
}

let ctx: Ctx
let articleId: string
let pageId: string

async function setup(): Promise<Ctx> {
  const {
    client: c,
    db,
    collectionIds,
  } = await setupMultiCollectionTestClient([articlesDefinition, pagesDefinition], {
    requestContext: superAdmin,
    richTextPopulate,
  })
  return {
    client: c,
    db,
    articlesCollectionId: collectionIds[articlesDefinition.path] as string,
    pagesCollectionId: collectionIds[pagesDefinition.path] as string,
  }
}

async function teardown(c: Ctx) {
  try {
    await c.db.commands.collections.delete(c.pagesCollectionId)
  } catch (err) {
    console.error('Failed to delete pages collection:', err)
  }
  try {
    await c.db.commands.collections.delete(c.articlesCollectionId)
  } catch (err) {
    console.error('Failed to delete articles collection:', err)
  }
}

beforeAll(async () => {
  ctx = await setup()

  // Target article, published with its original title.
  const articles = ctx.client.collection(articlesDefinition.path)
  const createdArticle = await articles.create({ title: 'Original Title' })
  articleId = createdArticle.documentId
  await articles.changeStatus(articleId, 'published')

  // A page whose `content` block carries two internal-link envelopes to the
  // article — both seeded with the article's title at link-pick time.
  const pages = ctx.client.collection(pagesDefinition.path)
  const createdPage = await pages.create({
    title: 'Linking Page',
    content: [
      {
        _id: 'link-block-1',
        _type: 'linkBlock',
        bodyPopulated: makeLinkValue(articlesDefinition.path, articleId, 'Original Title'),
        bodySnapshot: makeLinkValue(articlesDefinition.path, articleId, 'Original Title'),
      },
    ],
  })
  pageId = createdPage.documentId
  await pages.changeStatus(pageId, 'published')
}, 30_000)

afterAll(async () => {
  await teardown(ctx)
})

describe('richtext relation envelopes refresh per populateRelationsOnRead', () => {
  it('baseline — both leaves embed the original title', async () => {
    const pages = ctx.client.collection(pagesDefinition.path)
    const doc = await pages.findById<PageFields>(pageId)

    expect(doc).not.toBeNull()
    const block = doc?.fields.content?.[0]
    expect(block?._type).toBe('linkBlock')
    expect(embeddedLinkTitle(block?.bodyPopulated)).toBe('Original Title')
    expect(embeddedLinkTitle(block?.bodySnapshot)).toBe('Original Title')
  })

  it('after the target is updated and re-published, only the populate-true leaf refreshes', async () => {
    // Update + re-publish the target so the published view changes — the
    // populate adapter reads `readMode: 'published'`.
    const articles = ctx.client.collection(articlesDefinition.path)
    await articles.update(articleId, { title: 'Updated Title' })
    await articles.changeStatus(articleId, 'published')

    const pages = ctx.client.collection(pagesDefinition.path)
    const doc = await pages.findById<PageFields>(pageId)

    expect(doc).not.toBeNull()
    const block = doc?.fields.content?.[0]

    // populateRelationsOnRead: true → refreshed against the published target.
    expect(embeddedLinkTitle(block?.bodyPopulated)).toBe('Updated Title')
    // populateRelationsOnRead: false → persisted snapshot served as-is.
    expect(embeddedLinkTitle(block?.bodySnapshot)).toBe('Original Title')
  })
})
