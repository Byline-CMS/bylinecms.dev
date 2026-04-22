/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Exercises the draft-over-published fallback that Phase 5 (status-aware
 * reads) unlocks.
 *
 * Setup for each case:
 *   1. create a document in draft
 *   2. publish it                    → v1 { status: 'published' }
 *   3. update it (creates v2 draft)  → v1 stays 'published', v2 is 'draft'
 *
 * After step 3, `current_documents` now surfaces v2 (the newest version,
 * irrespective of status). `current_published_documents` still surfaces v1.
 *
 * The client defaults to `status: 'published'`, so public reads in state (3)
 * return v1's content. Passing `status: 'any'` returns v2. This mirrors how
 * a public blog would behave while an editor is working on a draft revision.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestArticlesCollection } from '../fixtures/collections.js'
import { setupTestClient, type TestContext, teardownTestClient } from '../fixtures/setup.js'

let ctx: TestContext
const testSuffix = `${Date.now()}-status-${Math.floor(Math.random() * 1e6)}`

beforeAll(async () => {
  const definition = createTestArticlesCollection(testSuffix)
  ctx = await setupTestClient(definition)
}, 30_000)

afterAll(async () => {
  await teardownTestClient(ctx)
})

/**
 * Seed a document into the "draft-over-published" state and return the
 * document id plus the two version ids so tests can assert against either.
 */
async function seedDraftOverPublished(params: {
  title: string
  path: string
  publishedSummary: string
  draftSummary: string
}) {
  const handle = ctx.client.collection(ctx.definition.path)

  const created = await handle.create({
    title: params.title,
    path: params.path,
    summary: params.publishedSummary,
  })

  await handle.changeStatus(created.documentId, 'published')
  const publishedVersionId = (
    await ctx.db.queries.documents.getCurrentVersionMetadata({
      collection_id: ctx.collectionId,
      document_id: created.documentId,
    })
  )?.document_version_id

  // Saving fresh content without transitioning status creates a new `draft`
  // version while leaving the earlier `published` version intact (see
  // document-lifecycle.updateDocument / createDocumentVersion with
  // action='update'). That's the state Phase 5 is designed for.
  const updated = await handle.update(created.documentId, {
    title: params.title,
    path: params.path,
    summary: params.draftSummary,
  })

  return {
    documentId: created.documentId,
    publishedVersionId,
    draftVersionId: updated.documentVersionId,
  }
}

// ---------------------------------------------------------------------------
// findById — draft-over-published fallback
// ---------------------------------------------------------------------------

describe('findById with draft-over-published versions', () => {
  it("returns the last published version by default (status: 'published')", async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId, publishedVersionId } = await seedDraftOverPublished({
      title: 'Phase 5 Article',
      path: 'phase-5-article',
      publishedSummary: 'Public summary',
      draftSummary: 'In-progress summary',
    })

    const doc = await handle.findById(documentId)

    expect(doc).not.toBeNull()
    expect(doc?.versionId).toBe(publishedVersionId)
    expect(doc?.status).toBe('published')
    expect(doc?.fields.summary).toBe('Public summary')
  })

  it("returns the newest (draft) version with status: 'any'", async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId, draftVersionId } = await seedDraftOverPublished({
      title: 'Any-mode Article',
      path: 'any-mode-article',
      publishedSummary: 'Public',
      draftSummary: 'Draft',
    })

    const doc = await handle.findById(documentId, { status: 'any' })

    expect(doc).not.toBeNull()
    expect(doc?.versionId).toBe(draftVersionId)
    expect(doc?.status).toBe('draft')
    expect(doc?.fields.summary).toBe('Draft')
  })
})

// ---------------------------------------------------------------------------
// findByPath — same fallback semantics
// ---------------------------------------------------------------------------

describe('findByPath with draft-over-published versions', () => {
  it('returns the last published version by default', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    await seedDraftOverPublished({
      title: 'Path Public Title',
      path: 'path-public',
      publishedSummary: 'Public',
      draftSummary: 'Draft',
    })

    const doc = await handle.findByPath('path-public')

    expect(doc?.fields.summary).toBe('Public')
    expect(doc?.status).toBe('published')
  })

  it("returns the draft version with status: 'any'", async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    await seedDraftOverPublished({
      title: 'Path Any Title',
      path: 'path-any',
      publishedSummary: 'Public',
      draftSummary: 'Draft',
    })

    const doc = await handle.findByPath('path-any', { status: 'any' })

    expect(doc?.fields.summary).toBe('Draft')
    expect(doc?.status).toBe('draft')
  })
})

// ---------------------------------------------------------------------------
// find — only published docs surface by default
// ---------------------------------------------------------------------------

describe('find with draft-over-published versions', () => {
  it('only surfaces docs with a published version by default', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    // A doc that is only a draft (never published) should be absent from
    // the default find() results.
    const draftOnly = await handle.create({
      title: 'Draft-only Article',
      path: 'draft-only',
      summary: 'Never published',
    })

    // A doc in draft-over-published state should appear, with its
    // *published* fields.
    await seedDraftOverPublished({
      title: 'Find List Article',
      path: 'find-list-article',
      publishedSummary: 'Published body',
      draftSummary: 'Draft body',
    })

    const publishedView = await handle.find()
    const publishedPaths = publishedView.docs.map((d) => d.path)
    expect(publishedPaths).toContain('find-list-article')
    expect(publishedPaths).not.toContain('draft-only')

    // Cross-check: status: 'any' sees the draft-only doc too.
    const anyView = await handle.find({ status: 'any' })
    const anyPaths = anyView.docs.map((d) => d.path)
    expect(anyPaths).toContain('draft-only')
    expect(anyPaths).toContain('find-list-article')

    // And in draft-over-published state, published mode shows published
    // content while any mode shows the draft.
    const publishedDoc = publishedView.docs.find((d) => d.path === 'find-list-article')
    expect(publishedDoc?.fields.summary).toBe('Published body')

    const anyDoc = anyView.docs.find((d) => d.path === 'find-list-article')
    expect(anyDoc?.fields.summary).toBe('Draft body')

    // Clean up so it doesn't pollute other tests' totals.
    await handle.delete(draftOnly.documentId)
  })
})

// Populate + readMode end-to-end coverage lives in
// `client-populate-status.integration.test.ts` (separate file because it
// needs two collections and the shared `setupTestClient` fixture only
// registers one). Unit coverage: `tests/unit/status-aware-reads.test.node.ts`.
