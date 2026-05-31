/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestArticlesCollection } from '../fixtures/collections.js'
import { setupTestClient, type TestContext, teardownTestClient } from '../fixtures/setup.js'

// Phase 5 default is `status: 'published'`. The write-path tests here seed
// drafts and immediately read them back to verify write semantics, so they
// explicitly opt into `status: 'any'` — consistent with how an admin
// caller would exercise these APIs.
const any = { status: 'any' as const }

let ctx: TestContext
// Append a random discriminator so parallel test files that both initialise
// at the same millisecond can't collide on the `collections.path` unique key.
const testSuffix = `${Date.now()}-write-${Math.floor(Math.random() * 1e6)}`

beforeAll(async () => {
  const definition = createTestArticlesCollection(testSuffix)
  ctx = await setupTestClient(definition)
}, 30_000)

afterAll(async () => {
  await teardownTestClient(ctx)
})

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

describe('client.collection().create()', () => {
  it('creates a document that is immediately readable via find/findById', async () => {
    const { documentId, documentVersionId } = await ctx.client
      .collection(ctx.definition.path)
      .create(
        {
          title: 'Hello from Phase 4',
          path: 'hello-phase-4',
          summary: 'Written through the client write path.',
          views: 7,
          featured: false,
        },
        // Override the version path explicitly. The fixture's `useAsPath: 'title'`
        // would otherwise slugify the title; `path` here is the field, not the
        // version-column override — they share a name but live on different
        // axes (field-data vs version-row metadata).
        { path: 'hello-phase-4' }
      )

    expect(documentId).toBeTruthy()
    expect(documentVersionId).toBeTruthy()

    const byId = await ctx.client.collection(ctx.definition.path).findById(documentId, any)
    expect(byId?.id).toBe(documentId)
    expect(byId?.fields.title).toBe('Hello from Phase 4')

    const byPath = await ctx.client.collection(ctx.definition.path).findByPath('hello-phase-4', any)
    expect(byPath?.id).toBe(documentId)
  })

  it('auto-generates a path when none is supplied', async () => {
    // Fixture uses `useAsPath: 'title'`, so omitting an explicit path
    // override falls through to the slugified title.
    const { documentId } = await ctx.client
      .collection(ctx.definition.path)
      .create({ title: 'Auto Path Article', summary: 's' })

    const doc = await ctx.client.collection(ctx.definition.path).findById(documentId, any)
    expect(doc?.path).toBe('auto-path-article')
  })
})

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('client.collection().update()', () => {
  it('replaces fields and bumps the version id', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const created = await handle.create({
      title: 'Original',
      path: 'update-target',
      summary: 'original summary',
      views: 1,
    })

    const updated = await handle.update(created.documentId, {
      title: 'Revised',
      path: 'update-target',
      summary: 'revised summary',
      views: 2,
    })

    expect(updated.documentId).toBe(created.documentId)
    expect(updated.documentVersionId).not.toBe(created.documentVersionId)

    const doc = await handle.findById(created.documentId, any)
    expect(doc?.fields.title).toBe('Revised')
    expect(doc?.fields.summary).toBe('revised summary')
    expect(doc?.fields.views).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// availableLocales (editorial advertised set — Slice 3 lifecycle threading)
// ---------------------------------------------------------------------------

describe('client write path — availableLocales', () => {
  it('persists the advertised set on create and surfaces it on read', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create(
      { title: 'Advertised', path: 'advertised-create', summary: 's' },
      { path: 'advertised-create', availableLocales: ['fr', 'en'] }
    )

    const doc = await handle.findById(documentId, any)
    expect(doc?.availableLocales, 'sorted advertised set').toEqual(['en', 'fr'])
  })

  it('leaves the set untouched on an update that omits the param (sticky)', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create(
      { title: 'Sticky', path: 'advertised-sticky', summary: 's' },
      { path: 'advertised-sticky', availableLocales: ['en', 'de'] }
    )

    // Update with no availableLocales — advertising must carry forward.
    await handle.update(documentId, { title: 'Sticky v2', path: 'advertised-sticky', summary: 's' })

    const doc = await handle.findById(documentId, any)
    expect(doc?.availableLocales, 'carried forward across the version').toEqual(['de', 'en'])
  })

  it('replaces the set wholesale when an explicit array is supplied', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create(
      { title: 'Replace', path: 'advertised-replace', summary: 's' },
      { path: 'advertised-replace', availableLocales: ['en', 'fr'] }
    )

    await handle.update(
      documentId,
      { title: 'Replace v2', path: 'advertised-replace', summary: 's' },
      { availableLocales: ['de'] }
    )

    const doc = await handle.findById(documentId, any)
    expect(doc?.availableLocales, 'en/fr replaced by de').toEqual(['de'])
  })

  it('clears the set when given an empty array', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create(
      { title: 'Clear', path: 'advertised-clear', summary: 's' },
      { path: 'advertised-clear', availableLocales: ['en', 'fr'] }
    )

    await handle.update(
      documentId,
      { title: 'Clear v2', path: 'advertised-clear', summary: 's' },
      { availableLocales: [] }
    )

    const doc = await handle.findById(documentId, any)
    expect(doc?.availableLocales, 'cleared').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// changeStatus()
// ---------------------------------------------------------------------------

describe('client.collection().changeStatus()', () => {
  it('transitions draft → published and surfaces in status-filtered reads', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'Publish Me',
      path: 'publish-me',
      summary: 's',
    })

    const result = await handle.changeStatus(documentId, 'published')
    expect(result).toEqual({ previousStatus: 'draft', newStatus: 'published' })

    // No `any` here — the doc is now published, so the default
    // status-aware read should find it.
    const doc = await handle.findById(documentId)
    expect(doc?.status).toBe('published')
  })

  it('rejects invalid transitions (draft → archived skipping published)', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'Invalid Transition',
      path: 'invalid-transition',
      summary: 's',
    })

    await expect(handle.changeStatus(documentId, 'archived')).rejects.toThrowError()
  })
})

// ---------------------------------------------------------------------------
// unpublish()
// ---------------------------------------------------------------------------

describe('client.collection().unpublish()', () => {
  it('archives the published version', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'To Unpublish',
      path: 'to-unpublish',
      summary: 's',
    })
    await handle.changeStatus(documentId, 'published')

    const before = await handle.findById(documentId)
    expect(before?.status).toBe('published')

    const result = await handle.unpublish(documentId)
    expect(result.archivedCount).toBeGreaterThan(0)

    // After unpublish the doc is archived — no longer published, so pass
    // `any` to still find it in the archived state.
    const after = await handle.findById(documentId, any)
    expect(after?.status).toBe('archived')
  })
})

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe('client.collection().delete()', () => {
  it('soft-deletes the document and hides it from subsequent reads', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'To Delete',
      path: 'to-delete',
      summary: 's',
    })

    // Confirm it's readable first (draft — needs `any`).
    const before = await handle.findById(documentId, any)
    expect(before?.id).toBe(documentId)

    const result = await handle.delete(documentId)
    expect(result.deletedVersionCount).toBeGreaterThan(0)

    // Both views filter soft-deleted rows, so neither mode returns the doc.
    const after = await handle.findById(documentId, any)
    expect(after).toBeNull()

    const byPath = await handle.findByPath('to-delete', any)
    expect(byPath).toBeNull()
  })

  it('throws when the document does not exist', async () => {
    await expect(
      ctx.client.collection(ctx.definition.path).delete('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrowError(/document not found/)
  })
})
