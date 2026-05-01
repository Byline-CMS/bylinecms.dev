/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { fingerprintCollection } from './collection-fingerprint.js'
import type { CollectionDefinition } from '../@types/index.js'

// Minimal collection used as a baseline; individual tests mutate clones.
function baseCollection(): CollectionDefinition {
  return {
    path: 'news',
    labels: { singular: 'News Item', plural: 'News Items' },
    fields: [
      { name: 'title', type: 'text' },
      {
        name: 'body',
        type: 'array',
        fields: [
          { name: 'heading', type: 'text' },
          {
            name: 'blocks',
            type: 'blocks',
            blocks: [
              {
                blockType: 'photo',
                fields: [{ name: 'caption', type: 'text' }],
              },
            ],
          },
        ],
      },
      {
        name: 'category',
        type: 'relation',
        targetCollection: 'categories',
      },
    ],
    workflow: {
      statuses: [
        { name: 'draft', label: 'Draft' },
        { name: 'published', label: 'Published' },
        { name: 'archived', label: 'Archived' },
      ],
    },
    useAsTitle: 'title',
    useAsPath: 'title',
  }
}

describe('fingerprintCollection', () => {
  it('returns a 64-character lowercase hex SHA-256 string', async () => {
    const hash = await fingerprintCollection(baseCollection())
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic across repeated calls on the same definition', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = await fingerprintCollection(baseCollection())
    expect(a).toBe(b)
  })

  it('is invariant to top-level key insertion order', async () => {
    const a = await fingerprintCollection(baseCollection())

    // Rebuild the collection with keys inserted in a different order.
    const reordered: CollectionDefinition = {
      useAsPath: 'title',
      useAsTitle: 'title',
      workflow: baseCollection().workflow,
      fields: baseCollection().fields,
      labels: { singular: 'News Item', plural: 'News Items' },
      path: 'news',
    }

    expect(await fingerprintCollection(reordered)).toBe(a)
  })

  it('ignores label changes (presentation only)', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.labels = { singular: 'Article', plural: 'Articles' }
    expect(await fingerprintCollection(b)).toBe(a)
  })

  it('ignores hooks (functions cannot survive JSON)', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.hooks = {
      beforeCreate: async () => {},
      afterUpdate: async () => {},
    }
    expect(await fingerprintCollection(b)).toBe(a)
  })

  it('ignores search / showStats (admin UX only)', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.search = { fields: ['title', 'body.heading'] }
    b.showStats = true
    expect(await fingerprintCollection(b)).toBe(a)
  })

  it('ignores field-level admin metadata (label, helpText, placeholder)', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    const title = b.fields.find((f) => f.name === 'title') as any
    title.label = 'Title'
    title.helpText = 'The news headline'
    title.placeholder = 'Enter a headline'
    expect(await fingerprintCollection(b)).toBe(a)
  })

  it('ignores workflow status labels and verbs', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.workflow = {
      statuses: [
        { name: 'draft', label: 'Scratch pad', verb: 'Start over' },
        { name: 'published', label: 'Live', verb: 'Go live' },
        { name: 'archived', label: 'Cold storage', verb: 'Archive' },
      ],
    }
    expect(await fingerprintCollection(b)).toBe(a)
  })

  it('changes when a field is added', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.fields.push({ name: 'summary', type: 'text' })
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when a field is renamed', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    ;(b.fields[0] as any).name = 'headline'
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when a field type changes', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    ;(b.fields[0] as any).type = 'textArea'
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when `optional` flips on a field', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    ;(b.fields[0] as any).optional = true
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when a relation target changes', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    const rel = b.fields.find((f) => f.name === 'category') as any
    rel.targetCollection = 'tags'
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when a block variant is renamed', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    const body = b.fields.find((f) => f.name === 'body') as any
    const blocksField = body.fields.find((f: any) => f.name === 'blocks')
    blocksField.blocks[0].blockType = 'image'
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when a workflow status is inserted', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.workflow = {
      statuses: [
        { name: 'draft' },
        { name: 'needs_review' },
        { name: 'published' },
        { name: 'archived' },
      ],
    }
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when useAsPath changes', async () => {
    const a = await fingerprintCollection(baseCollection())
    const b = baseCollection()
    b.useAsPath = 'category'
    expect(await fingerprintCollection(b)).not.toBe(a)
  })

  it('changes when an image-field upload mimeTypes change', async () => {
    const a = baseCollection()
    a.fields.push({
      name: 'cover',
      type: 'image',
      upload: { mimeTypes: ['image/*'] },
    })
    const hashA = await fingerprintCollection(a)

    const b = baseCollection()
    b.fields.push({
      name: 'cover',
      type: 'image',
      upload: { mimeTypes: ['video/*'] },
    })
    expect(await fingerprintCollection(b)).not.toBe(hashA)
  })

  it('ignores image-field upload storage provider (runtime detail)', async () => {
    const a = baseCollection()
    a.fields.push({
      name: 'cover',
      type: 'image',
      upload: { mimeTypes: ['image/*'] },
    })
    const hashA = await fingerprintCollection(a)

    const b = baseCollection()
    b.fields.push({
      name: 'cover',
      type: 'image',
      upload: {
        mimeTypes: ['image/*'],
        // Fake storage provider — runtime detail, excluded from canonical shape.
        storage: { put: async () => {}, get: async () => {}, delete: async () => {} } as any,
      },
    })
    expect(await fingerprintCollection(b)).toBe(hashA)
  })

  it('ignores image-field upload hooks (functions never canonicalise)', async () => {
    const a = baseCollection()
    a.fields.push({
      name: 'cover',
      type: 'image',
      upload: { mimeTypes: ['image/*'] },
    })
    const hashA = await fingerprintCollection(a)

    const b = baseCollection()
    b.fields.push({
      name: 'cover',
      type: 'image',
      upload: {
        mimeTypes: ['image/*'],
        hooks: {
          beforeStore: () => 'renamed.jpg',
          afterStore: () => {},
        },
      },
    })
    expect(await fingerprintCollection(b)).toBe(hashA)
  })

  it('ignores select option labels (only `value` is structural)', async () => {
    const a = baseCollection()
    a.fields.push({
      name: 'priority',
      type: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
    })
    const hashA = await fingerprintCollection(a)

    const b = baseCollection()
    b.fields.push({
      name: 'priority',
      type: 'select',
      options: [
        { value: 'low', label: 'Not so important' },
        { value: 'high', label: 'Critical' },
      ],
    })
    expect(await fingerprintCollection(b)).toBe(hashA)
  })
})
