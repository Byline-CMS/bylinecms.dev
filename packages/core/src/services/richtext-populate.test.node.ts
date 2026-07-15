/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth, createRequestContext } from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import { createReadContext } from './populate.js'
import {
  collectRichTextLeaves,
  createRichTextDocumentReader,
  populateRichTextFields,
  resolvePopulateOnRead,
  validateRichTextFieldFlags,
} from './richtext-populate.js'
import type { CollectionDefinition, FieldSet, IDbAdapter, RichTextField } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Fixture — a synthetic collection that exercises every nesting type the
// walker needs to handle: top-level, group, array, blocks (with two block
// types), and richText nested inside a block's array sub-field.
// ---------------------------------------------------------------------------

const richTextValue = (label: string) => ({ root: { type: 'root', children: [], _label: label } })

const fields: FieldSet = [
  { name: 'title', type: 'text', label: 'Title' },
  { name: 'body', type: 'richText', label: 'Body' },
  {
    name: 'meta',
    type: 'group',
    label: 'Meta',
    fields: [{ name: 'summary', type: 'richText', label: 'Summary' }],
  },
  {
    name: 'faq',
    type: 'array',
    label: 'FAQ',
    fields: [{ name: 'answer', type: 'richText', label: 'Answer' }],
  },
  {
    name: 'content',
    type: 'blocks',
    label: 'Content',
    blocks: [
      {
        blockType: 'photoBlock',
        fields: [{ name: 'caption', type: 'richText', label: 'Caption' }],
      },
      {
        blockType: 'richTextBlock',
        fields: [{ name: 'richText', type: 'richText', label: 'RichText' }],
      },
    ],
  },
]

const data = {
  title: 'Post',
  body: richTextValue('body'),
  meta: { summary: richTextValue('summary') },
  faq: [{ answer: richTextValue('answer-0') }, { answer: richTextValue('answer-1') }],
  content: [
    { _id: 'a', _type: 'photoBlock', caption: richTextValue('caption') },
    { _id: 'b', _type: 'richTextBlock', richText: richTextValue('rt') },
  ],
}

// ---------------------------------------------------------------------------
// collectRichTextLeaves
// ---------------------------------------------------------------------------

describe('collectRichTextLeaves', () => {
  it('yields top-level richText fields', () => {
    const out = Array.from(collectRichTextLeaves(fields, data))
    const paths = out.map((l) => l.fieldPath)
    expect(paths).toContain('body')
  })

  it('recurses through group fields', () => {
    const out = Array.from(collectRichTextLeaves(fields, data))
    const paths = out.map((l) => l.fieldPath)
    expect(paths).toContain('meta.summary')
  })

  it('recurses through array fields with index in path', () => {
    const out = Array.from(collectRichTextLeaves(fields, data))
    const paths = out.map((l) => l.fieldPath)
    expect(paths).toContain('faq.0.answer')
    expect(paths).toContain('faq.1.answer')
  })

  it('dispatches blocks on _type and recurses into matching block schema', () => {
    const out = Array.from(collectRichTextLeaves(fields, data))
    const paths = out.map((l) => l.fieldPath)
    expect(paths).toContain('content.0.caption')
    expect(paths).toContain('content.1.richText')
  })

  it('yields the raw richText value for each leaf', () => {
    const out = Array.from(collectRichTextLeaves(fields, data))
    const bodyLeaf = out.find((l) => l.fieldPath === 'body')
    expect(bodyLeaf?.value).toEqual(richTextValue('body'))
  })

  it('skips missing data without throwing', () => {
    const out = Array.from(collectRichTextLeaves(fields, { title: 'only-title' }))
    // No richText values present in data — walker yields nothing.
    expect(out).toEqual([])
  })

  it('skips block items with unknown _type', () => {
    const dataWithUnknownBlock = {
      content: [
        { _id: 'x', _type: 'unknownBlock', caption: richTextValue('skipped') },
        { _id: 'b', _type: 'richTextBlock', richText: richTextValue('kept') },
      ],
    }
    const out = Array.from(collectRichTextLeaves(fields, dataWithUnknownBlock))
    const paths = out.map((l) => l.fieldPath)
    expect(paths).toEqual(['content.1.richText'])
  })

  it('skips block items with no _type', () => {
    const dataWithoutType = {
      content: [{ _id: 'a', caption: richTextValue('skipped') }],
    }
    const out = Array.from(collectRichTextLeaves(fields, dataWithoutType))
    expect(out).toEqual([])
  })
})

describe('createRichTextDocumentReader', () => {
  const target: CollectionDefinition = {
    path: 'media',
    labels: { singular: 'Media', plural: 'Media' },
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'tenant', type: 'text', label: 'Tenant' },
    ],
    hooks: { beforeRead: () => ({ tenant: 'alice' }) },
  }

  function dbMock() {
    const getCollectionByPath = vi.fn().mockResolvedValue({ id: 'media-id', path: 'media' })
    const getDocumentsByDocumentIds = vi.fn().mockResolvedValue([])
    return {
      db: {
        queries: {
          collections: { getCollectionByPath },
          documents: { getDocumentsByDocumentIds },
        },
      } as unknown as IDbAdapter,
      getCollectionByPath,
      getDocumentsByDocumentIds,
    }
  }

  it('asserts target ability before adapter access', async () => {
    const { db, getCollectionByPath, getDocumentsByDocumentIds } = dbMock()
    const read = createRichTextDocumentReader({
      db,
      collections: [target],
      requestContext: createRequestContext({
        actor: new AdminAuth({ id: 'denied', abilities: ['collections.posts.read'] }),
        readMode: 'published',
      }),
      readContext: createReadContext(),
      readMode: 'published',
    })

    await expect(read({ collectionPath: 'media', documentIds: ['m1'] })).rejects.toMatchObject({
      code: 'ERR_FORBIDDEN',
    })
    expect(getCollectionByPath).not.toHaveBeenCalled()
    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
  })

  it('applies target beforeRead filters to the batch', async () => {
    const { db, getDocumentsByDocumentIds } = dbMock()
    const read = createRichTextDocumentReader({
      db,
      collections: [target],
      requestContext: createRequestContext({
        actor: new AdminAuth({ id: 'reader', abilities: ['collections.media.read'] }),
        readMode: 'published',
      }),
      readContext: createReadContext(),
      readMode: 'published',
    })

    await read({ collectionPath: 'media', documentIds: ['m1'] })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'media-id',
        document_ids: ['m1'],
        readMode: 'published',
        filters: [expect.objectContaining({ kind: 'field', fieldName: 'tenant', value: 'alice' })],
      })
    )
  })

  it('runs target rich-text population and actor-aware afterRead once per materialization', async () => {
    const afterRead = vi.fn((ctx: any) => {
      if (ctx.requestContext.actor?.id === 'reader') delete ctx.doc.fields.secret
    })
    const recursiveTarget: CollectionDefinition = {
      ...target,
      fields: [
        ...target.fields,
        {
          name: 'body',
          type: 'richText',
          label: 'Body',
          populateRelationsOnRead: true,
        },
        { name: 'secret', type: 'text', label: 'Secret' },
      ],
      hooks: { ...target.hooks, afterRead },
    }
    const doc = {
      document_version_id: 'v1',
      document_id: 'm1',
      fields: { title: 'Media', tenant: 'alice', body: {}, secret: 'hidden' },
    }
    const { db, getDocumentsByDocumentIds } = dbMock()
    getDocumentsByDocumentIds.mockResolvedValue([doc])
    const readContext = createReadContext()
    const nestedResults: unknown[] = []
    const richTextPopulate = vi.fn(async (ctx: any) => {
      nestedResults.push(await ctx.readDocuments({ collectionPath: 'media', documentIds: ['m1'] }))
      ctx.value.refreshed = true
    })
    const requestContext = createRequestContext({
      actor: new AdminAuth({ id: 'reader', abilities: ['collections.media.read'] }),
      readMode: 'published',
    })
    const read = createRichTextDocumentReader({
      db,
      collections: [recursiveTarget],
      requestContext,
      readContext,
      readMode: 'published',
      richTextPopulate,
    })

    const first = await read({ collectionPath: 'media', documentIds: ['m1'] })
    const second = await read({ collectionPath: 'media', documentIds: ['m1'] })

    expect(first[0]?.fields.body.refreshed).toBe(true)
    expect(first[0]?.fields).not.toHaveProperty('secret')
    expect(second[0]).toBe(first[0])
    expect(nestedResults).toEqual([[]])
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(richTextPopulate).toHaveBeenCalledTimes(1)
    expect(afterRead).toHaveBeenCalledWith(expect.objectContaining({ requestContext, readContext }))
    expect(readContext.readCount).toBe(1)
    expect(readContext.visited).toContain('media-id:m1')
  })

  it('reuses a later batch target completed recursively instead of processing stale batch data', async () => {
    const afterRead = vi.fn((ctx: any) => {
      delete ctx.doc.fields.secret
      ctx.doc.fields.redacted = true
    })
    const batchTarget: CollectionDefinition = {
      ...target,
      fields: [
        ...target.fields,
        {
          name: 'body',
          type: 'richText',
          label: 'Body',
          populateRelationsOnRead: true,
        },
        { name: 'secret', type: 'text', label: 'Secret' },
      ],
      hooks: { ...target.hooks, afterRead },
    }
    const outerA = {
      document_version_id: 'v1',
      document_id: 'm1',
      fields: { title: 'A', tenant: 'alice', body: { link: 'm2' }, secret: 'a' },
    }
    const staleOuterB = {
      document_version_id: 'v2',
      document_id: 'm2',
      fields: { title: 'stale B', tenant: 'alice', body: {}, secret: 'stale' },
    }
    const recursiveB = {
      document_version_id: 'v2',
      document_id: 'm2',
      fields: { title: 'fresh B', tenant: 'alice', body: {}, secret: 'hidden' },
    }
    const { db, getDocumentsByDocumentIds } = dbMock()
    getDocumentsByDocumentIds.mockImplementation(async ({ document_ids }) =>
      document_ids.length === 2 ? [outerA, staleOuterB] : [recursiveB]
    )
    const richTextPopulate = vi.fn(async (ctx: any) => {
      if (typeof ctx.value.link !== 'string') return
      const linked = await ctx.readDocuments({
        collectionPath: 'media',
        documentIds: [ctx.value.link],
      })
      ctx.value.linkedTitle = linked[0]?.fields.title
    })
    const readContext = createReadContext()
    const read = createRichTextDocumentReader({
      db,
      collections: [batchTarget],
      requestContext: createRequestContext({
        actor: new AdminAuth({ id: 'reader', abilities: ['collections.media.read'] }),
        readMode: 'published',
      }),
      readContext,
      readMode: 'published',
      richTextPopulate,
    })

    const result = await read({ collectionPath: 'media', documentIds: ['m1', 'm2'] })

    expect(result[0]?.fields.body.linkedTitle).toBe('fresh B')
    expect(result[1]).toBe(recursiveB)
    expect(result[1]).not.toBe(staleOuterB)
    expect(result[1]?.fields).toMatchObject({ title: 'fresh B', redacted: true })
    expect(result[1]?.fields).not.toHaveProperty('secret')
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(2)
    expect(richTextPopulate).toHaveBeenCalledTimes(2)
    expect(afterRead).toHaveBeenCalledTimes(2)
    expect(readContext.readCount).toBe(2)
  })

  it('enforces the shared read budget before returning target documents', async () => {
    const { db, getDocumentsByDocumentIds } = dbMock()
    getDocumentsByDocumentIds.mockResolvedValue([
      { document_version_id: 'v1', document_id: 'm1', fields: { title: 'Media' } },
    ])
    const read = createRichTextDocumentReader({
      db,
      collections: [target],
      requestContext: createRequestContext({
        actor: new AdminAuth({ id: 'reader', abilities: ['collections.media.read'] }),
        readMode: 'published',
      }),
      readContext: createReadContext({ maxReads: 0 }),
      readMode: 'published',
    })

    await expect(read({ collectionPath: 'media', documentIds: ['m1'] })).rejects.toMatchObject({
      code: 'ERR_READ_BUDGET_EXCEEDED',
    })
  })
})

describe('populateRichTextFields auth context', () => {
  it('passes the operation context and secure reader to the adapter', async () => {
    const requestContext = createRequestContext({
      actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
      readMode: 'published',
    })
    const readContext = createReadContext()
    const readDocuments = vi.fn()
    const populate = vi.fn()

    await populateRichTextFields({
      fields: [
        {
          name: 'body',
          type: 'richText',
          label: 'Body',
          populateRelationsOnRead: true,
        },
      ],
      collectionPath: 'posts',
      documents: [{ fields: { body: richTextValue('body') } }],
      populate,
      readContext,
      requestContext,
      readMode: 'published',
      readDocuments,
    })

    expect(populate).toHaveBeenCalledWith(
      expect.objectContaining({ requestContext, readContext, readMode: 'published', readDocuments })
    )
  })
})

// ---------------------------------------------------------------------------
// resolvePopulateOnRead — default-derivation table
// ---------------------------------------------------------------------------

describe('resolvePopulateOnRead', () => {
  const baseField: RichTextField = { name: 'body', type: 'richText', label: 'Body' }

  it('defaults populate to false when embed defaults to true', () => {
    expect(resolvePopulateOnRead(baseField)).toBe(false)
  })

  it('derives populate from explicit embedRelationsOnSave: false', () => {
    expect(resolvePopulateOnRead({ ...baseField, embedRelationsOnSave: false })).toBe(true)
  })

  it('honours explicit populateRelationsOnRead: true (belt-and-braces)', () => {
    expect(
      resolvePopulateOnRead({
        ...baseField,
        embedRelationsOnSave: true,
        populateRelationsOnRead: true,
      })
    ).toBe(true)
  })

  it('honours explicit populateRelationsOnRead: false even when embed is also false', () => {
    // The invalid combination — caller has to validate separately.
    expect(
      resolvePopulateOnRead({
        ...baseField,
        embedRelationsOnSave: false,
        populateRelationsOnRead: false,
      })
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateRichTextFieldFlags
// ---------------------------------------------------------------------------

function makeCollection(richTextField: Partial<RichTextField>): CollectionDefinition {
  return {
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'body', type: 'richText', label: 'Body', ...richTextField },
    ],
  }
}

const BOTH = { populate: true, embed: true }
const POPULATE_ONLY = { populate: true, embed: false }
const NEITHER = { populate: false, embed: false }

describe('validateRichTextFieldFlags', () => {
  it('passes when default flags are used and both adapters are registered', () => {
    expect(() => validateRichTextFieldFlags([makeCollection({})], BOTH)).not.toThrow()
  })

  it('throws when default flags are used and the embed adapter is missing', () => {
    // Default `embedRelationsOnSave: true` requires the embed adapter.
    expect(() => validateRichTextFieldFlags([makeCollection({})], POPULATE_ONLY)).toThrow(
      /no richtext embed adapter is registered/i
    )
  })

  it('passes when default flags are used and no adapters are registered (snapshot mode, fields opted out)', () => {
    // Both flags explicitly off: field is non-renderable, so the
    // first-line "both off" check trips before the missing-adapter
    // checks. Wrap with a single field that opts out of both.
    expect(() => validateRichTextFieldFlags([], NEITHER)).not.toThrow()
  })

  it('throws when both flags are explicitly false', () => {
    expect(() =>
      validateRichTextFieldFlags(
        [makeCollection({ embedRelationsOnSave: false, populateRelationsOnRead: false })],
        BOTH
      )
    ).toThrow(/both .* set to false/i)
  })

  it('throws when populate is required but the populate adapter is missing', () => {
    // embedRelationsOnSave: false flips the default for populate to true.
    expect(() =>
      validateRichTextFieldFlags([makeCollection({ embedRelationsOnSave: false })], {
        populate: false,
        embed: true,
      })
    ).toThrow(/no richtext populate adapter is registered/i)
  })

  it('throws when belt-and-braces is asked for but no adapters are registered', () => {
    expect(() =>
      validateRichTextFieldFlags(
        [makeCollection({ embedRelationsOnSave: true, populateRelationsOnRead: true })],
        NEITHER
      )
    ).toThrow(/no richtext (populate|embed) adapter is registered/i)
  })

  it('reports nested richText paths inside blocks with the block type tag', () => {
    const collection: CollectionDefinition = {
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [
        {
          name: 'content',
          type: 'blocks',
          label: 'Content',
          blocks: [
            {
              blockType: 'photoBlock',
              fields: [
                {
                  name: 'caption',
                  type: 'richText',
                  label: 'Caption',
                  embedRelationsOnSave: false,
                  populateRelationsOnRead: false,
                },
              ],
            },
          ],
        },
      ],
    }
    expect(() => validateRichTextFieldFlags([collection], BOTH)).toThrow(
      /content\.<photoBlock>\.caption/
    )
  })
})
