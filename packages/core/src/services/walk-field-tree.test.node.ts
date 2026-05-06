/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { type FieldLeaf, walkFieldTree } from './walk-field-tree.js'
import type { FieldSet } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Fixture — every nesting shape the walker has to handle, plus a few
// near-misses (unknown block type, missing _type, non-array `array` data,
// non-object `group` data) to exercise the tolerance paths.
// ---------------------------------------------------------------------------

const fields: FieldSet = [
  { name: 'title', type: 'text', label: 'Title' },
  { name: 'body', type: 'richText', label: 'Body' },
  {
    name: 'meta',
    type: 'group',
    label: 'Meta',
    fields: [
      { name: 'summary', type: 'text', label: 'Summary' },
      {
        name: 'inner',
        type: 'group',
        label: 'Inner',
        fields: [{ name: 'note', type: 'text', label: 'Note' }],
      },
    ],
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
        fields: [
          { name: 'caption', type: 'richText', label: 'Caption' },
          { name: 'alt', type: 'text', label: 'Alt' },
        ],
      },
      {
        blockType: 'richTextBlock',
        fields: [
          // Same field name as `photoBlock.alt` but a different shape — guards
          // against any cross-variant leakage in the dispatch.
          { name: 'alt', type: 'richText', label: 'Alt-rich' },
        ],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Path coverage — every nesting shape yields the expected dotted paths.
// ---------------------------------------------------------------------------

describe('walkFieldTree — paths', () => {
  it('yields top-level value-leaves with field name as path', () => {
    const data = { title: 'hello', body: { kind: 'rt' } }
    const out = Array.from(walkFieldTree(fields, data))
    const paths = out.map((l) => l.fieldPath).sort()
    expect(paths).toEqual(['body', 'title'])
  })

  it('descends into nested group fields', () => {
    const data = { meta: { summary: 's', inner: { note: 'n' } } }
    const out = Array.from(walkFieldTree(fields, data))
    const paths = out.map((l) => l.fieldPath).sort()
    expect(paths).toEqual(['meta.inner.note', 'meta.summary'])
  })

  it('inlines numeric indices into array paths', () => {
    const data = {
      faq: [{ answer: { kind: 'a0' } }, { answer: { kind: 'a1' } }],
    }
    const out = Array.from(walkFieldTree(fields, data))
    const paths = out.map((l) => l.fieldPath).sort()
    expect(paths).toEqual(['faq.0.answer', 'faq.1.answer'])
  })

  it('dispatches blocks on _type and recurses into the matching variant', () => {
    const data = {
      content: [
        { _id: 'a', _type: 'photoBlock', caption: { kind: 'c' }, alt: 'plain' },
        { _id: 'b', _type: 'richTextBlock', alt: { kind: 'rt' } },
      ],
    }
    const out = Array.from(walkFieldTree(fields, data))
    const paths = out.map((l) => l.fieldPath).sort()
    expect(paths).toEqual(['content.0.alt', 'content.0.caption', 'content.1.alt'])
  })

  it('honours pathPrefix at the top of the walk', () => {
    const data = { title: 't' }
    const out = Array.from(walkFieldTree(fields, data, 'root'))
    expect(out.map((l) => l.fieldPath)).toEqual(['root.title'])
  })
})

// ---------------------------------------------------------------------------
// parent[key] === value invariant — consumers rely on this to mutate /
// replace the leaf in place (e.g. populate writing the resolved doc back).
// ---------------------------------------------------------------------------

describe('walkFieldTree — parent / key invariant', () => {
  it('parent[key] resolves to value at every yield', () => {
    const data = {
      title: 'hi',
      meta: { summary: 's' },
      faq: [{ answer: { kind: 'rt' } }],
      content: [{ _id: 'a', _type: 'photoBlock', alt: 'plain' }],
    }
    const out = Array.from(walkFieldTree(fields, data))
    expect(out.length).toBeGreaterThan(0)
    for (const leaf of out) {
      expect(leaf.parent[leaf.key]).toBe(leaf.value)
    }
  })

  it('mutation through parent[key] is visible to the caller', () => {
    const data = { title: 'before' }
    const out = Array.from(walkFieldTree(fields, data))
    const leaf = out.find((l) => l.fieldPath === 'title') as FieldLeaf
    leaf.parent[leaf.key] = 'after'
    expect(data.title).toBe('after')
  })
})

// ---------------------------------------------------------------------------
// Tolerance paths — malformed / missing data is skipped, never thrown.
// ---------------------------------------------------------------------------

describe('walkFieldTree — tolerance', () => {
  it('returns an empty iterator for null / undefined data', () => {
    expect(Array.from(walkFieldTree(fields, null))).toEqual([])
    expect(Array.from(walkFieldTree(fields, undefined))).toEqual([])
  })

  it('returns an empty iterator for non-object top-level data', () => {
    expect(Array.from(walkFieldTree(fields, [] as any))).toEqual([])
  })

  it('skips leaves whose value is null / undefined', () => {
    const data = { title: null, body: undefined } as any
    expect(Array.from(walkFieldTree(fields, data))).toEqual([])
  })

  it('skips a group whose value is non-object', () => {
    const data = { meta: 'not-an-object' } as any
    expect(Array.from(walkFieldTree(fields, data))).toEqual([])
  })

  it('skips an array field whose value is not actually an array', () => {
    const data = { faq: { answer: { kind: 'rt' } } } as any
    expect(Array.from(walkFieldTree(fields, data))).toEqual([])
  })

  it('skips block items missing _type', () => {
    const data = {
      content: [{ _id: 'a', caption: { kind: 'rt' } }],
    } as any
    expect(Array.from(walkFieldTree(fields, data))).toEqual([])
  })

  it('skips block items with an unknown _type', () => {
    const data = {
      content: [
        { _id: 'a', _type: 'unknownBlock', caption: { kind: 'rt' } },
        { _id: 'b', _type: 'richTextBlock', alt: { kind: 'rt' } },
      ],
    }
    const out = Array.from(walkFieldTree(fields, data))
    expect(out.map((l) => l.fieldPath)).toEqual(['content.1.alt'])
  })

  it('skips a non-object array item silently', () => {
    const data = { faq: [null, 'string', { answer: { kind: 'rt' } }] } as any
    const out = Array.from(walkFieldTree(fields, data))
    expect(out.map((l) => l.fieldPath)).toEqual(['faq.2.answer'])
  })
})

// ---------------------------------------------------------------------------
// Field identity — the FieldLeaf carries the actual schema field def, so
// consumers can branch on `field.type` and read field-specific options.
// ---------------------------------------------------------------------------

describe('walkFieldTree — field identity', () => {
  it('yields the same Field reference declared in the schema', () => {
    const data = { title: 'hi' }
    const out = Array.from(walkFieldTree(fields, data))
    const titleLeaf = out.find((l) => l.fieldPath === 'title')
    expect(titleLeaf?.field).toBe(fields[0])
  })

  it('yields the block-variant field reference for blocks descents', () => {
    const data = {
      content: [{ _id: 'a', _type: 'photoBlock', alt: 'plain' }],
    }
    const out = Array.from(walkFieldTree(fields, data))
    const altLeaf = out.find((l) => l.fieldPath === 'content.0.alt')
    expect(altLeaf?.field.type).toBe('text') // photoBlock.alt is a text field
    expect(altLeaf?.field.name).toBe('alt')
  })
})
