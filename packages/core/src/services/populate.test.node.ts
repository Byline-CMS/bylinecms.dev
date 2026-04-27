/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { BylineError, ErrorCodes } from '../lib/errors.js'
import { __internal, createReadContext, type PopulateSpec, populateDocuments } from './populate.js'
import type { CollectionDefinition, IDbAdapter } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const postsCollection: CollectionDefinition = {
  path: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    {
      name: 'author',
      type: 'relation',
      label: 'Author',
      targetCollection: 'authors',
      optional: true,
    },
    {
      name: 'secondaryAuthor',
      type: 'relation',
      label: 'Secondary Author',
      targetCollection: 'authors',
      optional: true,
    },
    {
      name: 'related',
      type: 'array',
      label: 'Related',
      fields: [
        {
          name: 'person',
          type: 'relation',
          label: 'Person',
          targetCollection: 'authors',
          optional: true,
        },
      ],
    },
    {
      name: 'meta',
      type: 'group',
      label: 'Meta',
      fields: [
        {
          name: 'editor',
          type: 'relation',
          label: 'Editor',
          targetCollection: 'authors',
          optional: true,
        },
      ],
    },
    {
      name: 'content',
      type: 'blocks',
      label: 'Content',
      blocks: [
        {
          blockType: 'quote',
          fields: [
            { name: 'body', type: 'text', label: 'Body' },
            {
              name: 'attributedTo',
              type: 'relation',
              label: 'Attributed',
              targetCollection: 'authors',
              optional: true,
            },
          ],
        },
      ],
    },
  ],
}

const authorsCollection: CollectionDefinition = {
  path: 'authors',
  labels: { singular: 'Author', plural: 'Authors' },
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    {
      name: 'employer',
      type: 'relation',
      label: 'Employer',
      targetCollection: 'orgs',
      optional: true,
    },
  ],
}

const orgsCollection: CollectionDefinition = {
  path: 'orgs',
  labels: { singular: 'Org', plural: 'Orgs' },
  fields: [{ name: 'name', type: 'text', label: 'Name' }],
}

const allCollections = [postsCollection, authorsCollection, orgsCollection]

function relationRef(collectionId: string, documentId: string) {
  return {
    targetDocumentId: documentId,
    targetCollectionId: collectionId,
  }
}

/**
 * Build the expected envelope shape for a successfully populated leaf.
 * Mirrors `PopulatedRelationValue` — `leaf.value` metadata plus
 * `_resolved: true` and the attached `document`.
 */
function populatedEnvelope(collectionId: string, documentId: string, document: any) {
  return {
    targetDocumentId: documentId,
    targetCollectionId: collectionId,
    _resolved: true,
    document,
  }
}

type FetchMap = Record<string, Record<string, any>>

/**
 * Build a mock IDbAdapter where `getDocumentsByDocumentIds` returns
 * documents from a pre-seeded `store[collectionId][documentId]` map.
 *
 * An optional `pathByCollectionId` map simulates the production case
 * where populate is called with DB UUIDs and must fall back to
 * `getCollectionById(id)` to resolve them to a path.
 */
function makeMockAdapter(store: FetchMap = {}, pathByCollectionId: Record<string, string> = {}) {
  const getDocumentsByDocumentIds = vi.fn(
    async (params: {
      collection_id: string
      document_ids: string[]
      locale?: string
      fields?: string[]
    }) => {
      const bucket = store[params.collection_id] ?? {}
      return params.document_ids.map((id) => bucket[id]).filter((d) => d != null)
    }
  )

  const getCollectionById = vi.fn(async (id: string) => {
    const path = pathByCollectionId[id]
    return path ? { id, path } : null
  })

  const db = {
    commands: {
      collections: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      documents: {
        createDocumentVersion: vi.fn(),
        setDocumentStatus: vi.fn(),
        archivePublishedVersions: vi.fn(),
        softDeleteDocument: vi.fn(),
      },
    },
    queries: {
      collections: {
        getAllCollections: vi.fn(),
        getCollectionByPath: vi.fn(),
        getCollectionById,
      },
      documents: {
        getDocumentById: vi.fn(),
        getCurrentVersionMetadata: vi.fn(),
        getDocumentByPath: vi.fn(),
        getDocumentByVersion: vi.fn(),
        getDocumentsByVersionIds: vi.fn(),
        getDocumentsByDocumentIds,
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn(),
        getPublishedDocumentIds: vi.fn(),
        getDocumentCountsByStatus: vi.fn(),
        findDocuments: vi.fn(),
      },
    },
  } satisfies IDbAdapter

  return { db, getDocumentsByDocumentIds, getCollectionById }
}

function shapedDoc(
  collectionId: string,
  documentId: string,
  fields: Record<string, any>
): Record<string, any> {
  return {
    document_version_id: `ver:${documentId}`,
    document_id: documentId,
    path: documentId,
    status: 'published',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    _collection_id: collectionId,
    fields,
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

describe('matchesPopulate', () => {
  const { matchesPopulate } = __internal

  it('returns true when populate is true', () => {
    expect(matchesPopulate('anything', true)).toBe(true)
  })

  it("returns '*' when top-level populate is '*'", () => {
    // Top-level '*' matches every relation name with the '*' sub-spec,
    // so every leaf is fetched with the full document projection.
    expect(matchesPopulate('anything', '*')).toBe('*')
  })

  it('returns the field value from a PopulateMap', () => {
    expect(matchesPopulate('author', { author: true })).toBe(true)
    expect(matchesPopulate('author', { author: { select: ['name'] } })).toEqual({
      select: ['name'],
    })
  })

  it("returns '*' when a field selects the full document", () => {
    expect(matchesPopulate('author', { author: '*' })).toBe('*')
  })

  it('returns undefined for fields not in the map', () => {
    expect(matchesPopulate('author', { editor: true })).toBeUndefined()
  })
})

describe('collectRelationLeaves', () => {
  const { collectRelationLeaves } = __internal

  it('finds top-level relations when populate: true', () => {
    const fields = {
      title: 'hi',
      author: relationRef('authors', 'a1'),
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, true, leaves)
    expect(leaves).toHaveLength(1)
    expect(leaves[0].value.targetDocumentId).toBe('a1')
    expect(leaves[0].sub).toBe(true)
  })

  it('only matches named relations in a PopulateMap', () => {
    const fields = {
      author: relationRef('authors', 'a1'),
      secondaryAuthor: relationRef('authors', 'a2'),
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, { author: true }, leaves)
    expect(leaves).toHaveLength(1)
    expect(leaves[0].key).toBe('author')
  })

  it('recurses into group fields', () => {
    const fields = {
      meta: { editor: relationRef('authors', 'a3') },
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, true, leaves)
    expect(leaves.map((l) => l.value.targetDocumentId)).toEqual(['a3'])
  })

  it('recurses into array items', () => {
    const fields = {
      related: [{ person: relationRef('authors', 'a4') }, { person: relationRef('authors', 'a5') }],
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, true, leaves)
    expect(leaves.map((l) => l.value.targetDocumentId).sort()).toEqual(['a4', 'a5'])
  })

  it('recurses into blocks items, matching _type to blockType', () => {
    const fields = {
      content: [
        {
          _type: 'quote',
          body: 'hello',
          attributedTo: relationRef('authors', 'a6'),
        },
      ],
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, true, leaves)
    expect(leaves.map((l) => l.value.targetDocumentId)).toEqual(['a6'])
  })

  it('skips unknown block types silently', () => {
    const fields = {
      content: [
        {
          _type: 'nonExistent',
          attributedTo: relationRef('authors', 'a7'),
        },
      ],
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, true, leaves)
    expect(leaves).toEqual([])
  })

  it('skips leaves already replaced with resolved stubs', () => {
    const fields = {
      author: {
        ...relationRef('authors', 'a1'),
        _resolved: false,
      },
    }
    const leaves: any[] = []
    collectRelationLeaves(fields, postsCollection.fields, true, leaves)
    expect(leaves).toEqual([])
  })
})

describe('buildBatchSelect', () => {
  const { buildBatchSelect } = __internal

  const makeLeaf = (sub: any): any => ({
    sub,
    value: relationRef('authors', 'x'),
    parent: {},
    key: 'k',
    field: {} as any,
  })

  it("returns undefined when any leaf is '*' (full document)", () => {
    expect(buildBatchSelect([makeLeaf('*')], authorsCollection)).toBeUndefined()
  })

  it("'*' on any leaf dominates mixed inputs", () => {
    // A '*' leaf in the batch forces full-document fetch even when a
    // sibling leaf has an explicit select.
    expect(
      buildBatchSelect([makeLeaf({ select: ['employer'] }), makeLeaf('*')], authorsCollection)
    ).toBeUndefined()
  })

  it('returns identity-only for populate: true (default projection)', () => {
    // A bare `true` sub contributes no selects; the only entry in the
    // union comes from the target's identity field.
    expect(buildBatchSelect([makeLeaf(true)], authorsCollection)).toEqual(['name'])
  })

  it('unions explicit selects and adds the identity field', () => {
    const result = buildBatchSelect(
      [makeLeaf({ select: ['employer'] }), makeLeaf({ select: ['employer'] })],
      authorsCollection
    )
    expect(result?.sort()).toEqual(['employer', 'name'])
  })

  it('returns identity-only when sub has no select (just populate)', () => {
    // { populate: {} } is scope+depth forwarding, not a projection opt-in —
    // it should behave like `true` at this level.
    expect(buildBatchSelect([makeLeaf({ populate: {} })], authorsCollection)).toEqual(['name'])
  })

  it('merges true + explicit select: identity plus the explicit field', () => {
    const result = buildBatchSelect(
      [makeLeaf(true), makeLeaf({ select: ['employer'] })],
      authorsCollection
    )
    expect(result?.sort()).toEqual(['employer', 'name'])
  })

  it('uses useAsTitle when declared (preferred over first text field)', () => {
    const def: CollectionDefinition = {
      ...authorsCollection,
      useAsTitle: 'employer',
    }
    // Identity resolves to `employer` (useAsTitle) instead of `name`
    // (first text field).
    expect(buildBatchSelect([makeLeaf(true)], def)).toEqual(['employer'])
  })
})

// ---------------------------------------------------------------------------
// populateDocuments — behaviour
// ---------------------------------------------------------------------------

describe('populateDocuments', () => {
  it('is a no-op when populate is omitted', async () => {
    const { db, getDocumentsByDocumentIds } = makeMockAdapter()
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
    })

    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
    expect(doc.fields.author).toEqual(relationRef('authors', 'a1'))
  })

  it('is a no-op when depth: 0', async () => {
    const { db, getDocumentsByDocumentIds } = makeMockAdapter()
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: true,
      depth: 0,
    })

    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
    expect(doc.fields.author).toEqual(relationRef('authors', 'a1'))
  })

  it('populates a single top-level relation at depth 1', async () => {
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({ authors: { a1: author } })
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: true },
      depth: 1,
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc.fields.author).toEqual(populatedEnvelope('authors', 'a1', author))
  })

  it('populated envelope preserves relationshipType and cascadeDelete', async () => {
    // Link metadata on the original relation value (e.g. a weak-ref flag
    // or cascade-delete directive) must survive the populate pass so
    // callers can inspect or round-trip the relation.
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db } = makeMockAdapter({ authors: { a1: author } })
    const doc = shapedDoc('posts', 'p1', {
      author: {
        ...relationRef('authors', 'a1'),
        relationshipType: 'weak',
        cascadeDelete: true,
      },
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: true },
    })

    expect(doc.fields.author).toEqual({
      targetDocumentId: 'a1',
      targetCollectionId: 'authors',
      relationshipType: 'weak',
      cascadeDelete: true,
      _resolved: true,
      document: author,
    })
  })

  it('groups by target collection: one query per target per level', async () => {
    const a1 = shapedDoc('authors', 'a1', { name: 'Nora' })
    const a2 = shapedDoc('authors', 'a2', { name: 'Ava' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1, a2 },
    })

    const doc = shapedDoc('posts', 'p1', {
      author: relationRef('authors', 'a1'),
      secondaryAuthor: relationRef('authors', 'a2'),
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: true,
      depth: 1,
    })

    // Both relations target 'authors' → single query with [a1, a2].
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'authors',
        document_ids: expect.arrayContaining(['a1', 'a2']),
      })
    )
  })

  it('recurses at depth: 2 with nested populate', async () => {
    const org = shapedDoc('orgs', 'o1', { name: 'Acme' })
    const author = shapedDoc('authors', 'a1', {
      name: 'Nora',
      employer: relationRef('orgs', 'o1'),
    })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
      orgs: { o1: org },
    })

    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: { populate: { employer: true } } },
      depth: 2,
    })

    // One query per level.
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(2)
    expect(doc.fields.author.document).toBe(author)
    expect(author.fields.employer.document).toBe(org)
  })

  it('populate: true recursively populates at depth 2', async () => {
    const org = shapedDoc('orgs', 'o1', { name: 'Acme' })
    const author = shapedDoc('authors', 'a1', {
      name: 'Nora',
      employer: relationRef('orgs', 'o1'),
    })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
      orgs: { o1: org },
    })

    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: true,
      depth: 2,
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(2)
    expect(doc.fields.author.document).toBe(author)
    expect(author.fields.employer.document).toBe(org)
  })

  it('marks deleted targets with _resolved: false', async () => {
    const { db } = makeMockAdapter({ authors: {} }) // nothing there
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'gone') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: true },
    })

    expect(doc.fields.author).toEqual({
      targetDocumentId: 'gone',
      targetCollectionId: 'authors',
      _resolved: false,
    })
  })

  it('marks cycle targets with _cycle: true', async () => {
    // A → B → A. At depth 2, populate reaches A, materialises it, walks its
    // fields looking for further relations, finds a relation back to the
    // source document (already in `visited` because it was the input doc),
    // and replaces the leaf with the cycle marker instead of re-fetching.
    const post = shapedDoc('posts', 'p1', {})
    const author = shapedDoc('authors', 'a1', {
      name: 'Nora',
      // Synthetic cycle: author has a relation field into posts. Use the
      // `employer` relation slot but point at posts instead of orgs to
      // simulate the shape; the walker keys on whatever collection the
      // value declares.
      employer: relationRef('posts', 'p1'),
    })
    const { db } = makeMockAdapter({
      authors: { a1: author },
      posts: { p1: post },
    })

    post.fields.author = relationRef('authors', 'a1')

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [post],
      populate: true,
      depth: 3,
    })

    expect(post.fields.author.document).toBe(author)
    expect(author.fields.employer).toEqual({
      targetDocumentId: 'p1',
      targetCollectionId: 'posts',
      _resolved: true,
      _cycle: true,
    })
  })

  it('persists visited across calls that share a ReadContext', async () => {
    // First call loads author a1; second call (sharing the same context)
    // sees a1 as already-visited and renders the cycle marker.
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
    })

    const ctx = createReadContext()

    const doc1 = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })
    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc1],
      populate: { author: true },
      readContext: ctx,
    })
    expect(doc1.fields.author.document).toBe(author)

    const doc2 = shapedDoc('posts', 'p2', { author: relationRef('authors', 'a1') })
    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc2],
      populate: { author: true },
      readContext: ctx,
    })

    // Second call sees a1 already visited → skips fetch, renders cycle.
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc2.fields.author).toEqual({
      targetDocumentId: 'a1',
      targetCollectionId: 'authors',
      _resolved: true,
      _cycle: true,
    })
  })

  it('throws ERR_READ_BUDGET_EXCEEDED when maxReads is exceeded', async () => {
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db } = makeMockAdapter({ authors: { a1: author } })

    const ctx = createReadContext({ maxReads: 0 })

    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await expect(
      populateDocuments({
        db,
        collections: allCollections,
        collectionId: 'posts',
        documents: [doc],
        populate: { author: true },
        readContext: ctx,
      })
    ).rejects.toSatisfy(
      (err: BylineError) =>
        err instanceof BylineError && err.code === ErrorCodes.READ_BUDGET_EXCEEDED
    )
  })

  it('clamps depth to readContext.maxDepth', async () => {
    // maxDepth: 1 should stop after the first level even if depth: 5
    // is requested.
    const org = shapedDoc('orgs', 'o1', { name: 'Acme' })
    const author = shapedDoc('authors', 'a1', {
      name: 'Nora',
      employer: relationRef('orgs', 'o1'),
    })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
      orgs: { o1: org },
    })

    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: true,
      depth: 5,
      readContext: createReadContext({ maxDepth: 1 }),
    })

    // Only one level: author fetched, but employer stays as a raw ref.
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc.fields.author.document).toBe(author)
    expect(author.fields.employer).toEqual(relationRef('orgs', 'o1'))
  })

  it("populate: '*' fetches full documents at every depth (recursive)", async () => {
    // Top-level '*' = scope: all + full projection, transitive. At depth 2
    // both the author and its employer should come back with no fields
    // projection (fields: undefined → fetch all).
    const org = shapedDoc('orgs', 'o1', { name: 'Acme' })
    const author = shapedDoc('authors', 'a1', {
      name: 'Nora',
      employer: relationRef('orgs', 'o1'),
    })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
      orgs: { o1: org },
    })
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: '*',
      depth: 2,
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(2)
    // Both level-1 and level-2 calls fetch with no fields projection.
    for (const call of getDocumentsByDocumentIds.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ fields: undefined }))
    }
    expect(doc.fields.author.document).toBe(author)
    expect(author.fields.employer.document).toBe(org)
  })

  it("{ author: '*' } propagates '*' to nested relations at deeper levels", async () => {
    // Sub-spec '*' is symmetric with `true` — both propagate their
    // projection choice to the next level when the caller doesn't
    // specify explicit nested populate. So { author: '*' } at depth 2
    // fetches author full AND author's own relations full.
    const org = shapedDoc('orgs', 'o1', { name: 'Acme' })
    const author = shapedDoc('authors', 'a1', {
      name: 'Nora',
      employer: relationRef('orgs', 'o1'),
    })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
      orgs: { o1: org },
    })
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: '*' },
      depth: 2,
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(2)
    for (const call of getDocumentsByDocumentIds.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ fields: undefined }))
    }
    expect(author.fields.employer.document).toBe(org)
  })

  it("'*' sub-spec fetches the full target document (no fields projection)", async () => {
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
    })
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: '*' },
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'authors',
        fields: undefined,
      })
    )
    expect(doc.fields.author.document).toBe(author)
  })

  it('default projection sends identity-only fields list', async () => {
    // `populate: { author: true }` uses the default projection: the
    // target's identity field (`name` for authorsCollection) — no full
    // fetch, no explicit select.
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
    })
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: true },
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'authors',
        fields: ['name'],
      })
    )
  })

  it('forwards nested select + adds first text field for display', async () => {
    const author = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({
      authors: { a1: author },
    })
    const doc = shapedDoc('posts', 'p1', { author: relationRef('authors', 'a1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: { select: ['employer'] } },
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'authors',
        fields: expect.arrayContaining(['employer', 'name']),
      })
    )
  })

  it('populates relations inside array items', async () => {
    const a4 = shapedDoc('authors', 'a4', { name: 'Ivan' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({ authors: { a4 } })
    const doc = shapedDoc('posts', 'p1', {
      related: [{ person: relationRef('authors', 'a4') }],
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { person: true },
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc.fields.related[0].person.document).toBe(a4)
  })

  it('populates relations inside blocks items', async () => {
    const a6 = shapedDoc('authors', 'a6', { name: 'Quinn' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({ authors: { a6 } })
    const doc = shapedDoc('posts', 'p1', {
      content: [{ _type: 'quote', body: 'hello', attributedTo: relationRef('authors', 'a6') }],
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { attributedTo: true },
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc.fields.content[0].attributedTo.document).toBe(a6)
  })

  it('populates relations inside group fields', async () => {
    const a3 = shapedDoc('authors', 'a3', { name: 'Editor' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({ authors: { a3 } })
    const doc = shapedDoc('posts', 'p1', {
      meta: { editor: relationRef('authors', 'a3') },
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { editor: true },
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc.fields.meta.editor.document).toBe(a3)
  })

  it('de-duplicates IDs at a single level (one fetch for two references)', async () => {
    const a1 = shapedDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds } = makeMockAdapter({ authors: { a1 } })

    const doc = shapedDoc('posts', 'p1', {
      author: relationRef('authors', 'a1'),
      secondaryAuthor: relationRef('authors', 'a1'),
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: true,
    })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: 'authors', document_ids: ['a1'] })
    )
    // Both leaves get their own envelope, each wrapping the same fetched doc.
    expect(doc.fields.author.document).toBe(a1)
    expect(doc.fields.secondaryAuthor.document).toBe(a1)
  })

  it('uses composite (collection, document) keys so same id across collections stays distinct', async () => {
    // p1 is a post id; a different collection (authors) could theoretically
    // have a document with id 'p1' too. They must not collide in visited.
    const authorWithSameId = shapedDoc('authors', 'p1', { name: 'Nora' })
    const { db } = makeMockAdapter({
      authors: { p1: authorWithSameId },
    })

    const post = shapedDoc('posts', 'p1', { author: relationRef('authors', 'p1') })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [post],
      populate: { author: true },
    })

    // Post p1 was marked visited with key 'posts:p1'. Author p1 uses
    // 'authors:p1' — distinct. Author populates normally.
    expect(post.fields.author.document).toBe(authorWithSameId)
  })
})

// ---------------------------------------------------------------------------
// Interaction with unknown target collections
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DB-UUID resolution — the production case
// ---------------------------------------------------------------------------

describe('populateDocuments — DB UUID → path resolution', () => {
  it('falls back to getCollectionById when collectionId is a DB UUID', async () => {
    // Production flow: admin server fn passes DB UUIDs as collectionId and
    // targetCollectionId. The collections array carries CollectionDefinition
    // objects keyed by path, not UUID. Without the DB fallback, populate
    // early-exits because findDef can't resolve the UUID.
    const postsUuid = '019d3acf-aaaa-aaaa-aaaa-000000000001'
    const authorsUuid = '019d3acf-bbbb-bbbb-bbbb-000000000002'

    const author = shapedDoc(authorsUuid, 'a1', { name: 'Nora' })
    const { db, getDocumentsByDocumentIds, getCollectionById } = makeMockAdapter(
      { [authorsUuid]: { a1: author } },
      { [postsUuid]: 'posts', [authorsUuid]: 'authors' }
    )

    const doc = shapedDoc(postsUuid, 'p1', {
      author: { targetDocumentId: 'a1', targetCollectionId: authorsUuid },
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: postsUuid,
      documents: [doc],
      populate: { author: true },
    })

    // Both UUIDs got resolved via getCollectionById.
    expect(getCollectionById).toHaveBeenCalledWith(postsUuid)
    expect(getCollectionById).toHaveBeenCalledWith(authorsUuid)
    // And the populated document is in place.
    expect(doc.fields.author.document).toBe(author)
    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
  })

  it('caches collection resolution across multiple leaves in one call', async () => {
    const authorsUuid = '019d3acf-cccc-cccc-cccc-000000000003'
    const a1 = shapedDoc(authorsUuid, 'a1', { name: 'Nora' })
    const a2 = shapedDoc(authorsUuid, 'a2', { name: 'Ava' })
    const { db, getCollectionById } = makeMockAdapter(
      { [authorsUuid]: { a1, a2 } },
      { posts: 'posts', [authorsUuid]: 'authors' }
    )

    const doc = shapedDoc('posts', 'p1', {
      author: { targetDocumentId: 'a1', targetCollectionId: authorsUuid },
      secondaryAuthor: { targetDocumentId: 'a2', targetCollectionId: authorsUuid },
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: true,
    })

    // 'posts' resolved via path match (no DB query). 'authorsUuid' resolved
    // once via the DB fallback and reused for both leaves.
    const authorCalls = getCollectionById.mock.calls.filter(([arg]) => arg === authorsUuid).length
    expect(authorCalls).toBe(1)
  })
})

describe('populateDocuments — unknown target collection', () => {
  it('renders an unresolved stub when target collection is unregistered', async () => {
    // `weirdCollection` id has no matching CollectionDefinition.
    const { db } = makeMockAdapter({
      /* weirdCollection not present: batch will return empty */
      weirdCollection: {},
    })
    const doc = shapedDoc('posts', 'p1', {
      author: relationRef('weirdCollection', 'a1'),
    })

    await populateDocuments({
      db,
      collections: allCollections,
      collectionId: 'posts',
      documents: [doc],
      populate: { author: true },
    })

    expect(doc.fields.author).toEqual({
      targetDocumentId: 'a1',
      targetCollectionId: 'weirdCollection',
      _resolved: false,
    })
  })
})

// ---------------------------------------------------------------------------
// PopulateSpec type sanity (compile-time more than behaviour)
// ---------------------------------------------------------------------------

describe('PopulateSpec typing', () => {
  it('accepts nested populate and select options', () => {
    const spec: PopulateSpec = {
      author: { select: ['name'], populate: { employer: true } },
      editor: true,
    }
    expect(spec).toBeDefined()
  })

  it("accepts the '*' full-document shorthand at any leaf", () => {
    const spec: PopulateSpec = {
      author: '*',
      editor: { populate: { employer: '*' } },
    }
    expect(spec).toBeDefined()
  })
})
