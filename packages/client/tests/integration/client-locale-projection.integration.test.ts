/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end check that fallback locale selection does not depend on which
 * fields a read projects. The localized title is in the text store and the
 * localized summary in the JSON store; a German translation of the title alone
 * is incomplete, so every read path must fall back to English — including a
 * `select: ['title']` list and a populated relation that projects only the
 * title (both of which load the text store only).
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  type MultiCollectionTestContext,
  setupMultiCollectionTestClient,
} from '../fixtures/setup.js'

const suffix = Date.now()

const Topics: CollectionDefinition = {
  path: `test-locale-topics-${suffix}`,
  labels: { singular: 'Topic', plural: 'Topics' },
  useAsTitle: 'title',
  fields: [
    { name: 'title', type: 'text', localized: true, optional: true },
    { name: 'summary', type: 'richText', localized: true, optional: true },
  ],
}

const Notes: CollectionDefinition = {
  path: `test-locale-notes-${suffix}`,
  labels: { singular: 'Note', plural: 'Notes' },
  fields: [
    { name: 'name', type: 'text', optional: true },
    { name: 'topic', type: 'relation', targetCollection: Topics.path, optional: true },
  ],
}

const richText = (text: string) => ({
  root: { type: 'root', children: [{ type: 'text', text }] },
})

let ctx: MultiCollectionTestContext
let partialTopicId: string
let completeTopicId: string
let noteId: string

beforeAll(async () => {
  ctx = await setupMultiCollectionTestClient([Topics, Notes])
  const topicsId = ctx.collectionIds[Topics.path] as string
  const notesId = ctx.collectionIds[Notes.path] as string

  const partial = await ctx.db.commands.documents.createDocumentVersion({
    collectionId: topicsId,
    collectionVersion: 1,
    collectionConfig: Topics,
    action: 'create',
    documentData: {
      title: { en: 'Partial EN', de: 'Partial DE' },
      summary: { en: richText('Summary EN') },
    },
    path: `partial-${suffix}`,
    locale: 'all',
    status: 'published',
  })
  partialTopicId = partial.document.document_id as string

  const complete = await ctx.db.commands.documents.createDocumentVersion({
    collectionId: topicsId,
    collectionVersion: 1,
    collectionConfig: Topics,
    action: 'create',
    documentData: {
      title: { en: 'Complete EN', de: 'Complete DE' },
      summary: { en: richText('Summary EN'), de: richText('Summary DE') },
    },
    path: `complete-${suffix}`,
    locale: 'all',
    status: 'published',
  })
  completeTopicId = complete.document.document_id as string

  const note = await ctx.db.commands.documents.createDocumentVersion({
    collectionId: notesId,
    collectionVersion: 1,
    collectionConfig: Notes,
    action: 'create',
    documentData: {
      name: 'Note',
      topic: { targetDocumentId: partialTopicId, targetCollectionId: topicsId },
    },
    path: `note-${suffix}`,
    locale: 'all',
    status: 'published',
  })
  noteId = note.document.document_id as string
}, 30_000)

afterAll(async () => {
  for (const def of [Notes, Topics]) {
    try {
      await ctx.db.commands.collections.delete(ctx.collectionIds[def.path] as string)
    } catch (err) {
      console.error('Failed to clean up test collection:', err)
    }
  }
})

describe('fallback locale selection is independent of the projection', () => {
  it('a select: [title] list falls back for an incomplete translation', async () => {
    const result = await ctx.client
      .collection(Topics.path)
      .find({ locale: 'de', select: ['title'], pageSize: 50 })
    const byId = new Map(result.docs.map((d) => [d.id, d]))

    expect(byId.get(partialTopicId)?.fields.title).toBe('Partial EN')
    expect(byId.get(completeTopicId)?.fields.title).toBe('Complete DE')
  })

  it('a populated target projecting only its title falls back the same way', async () => {
    const note = await ctx.client.collection(Notes.path).findById(noteId, {
      locale: 'de',
      populate: { topic: { select: ['title'] } },
    })
    const topic = note?.fields.topic as { document?: { fields: { title?: string } } } | undefined

    expect(topic?.document?.fields.title).toBe('Partial EN')
  })
})
