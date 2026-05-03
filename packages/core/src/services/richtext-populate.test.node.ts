/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  collectRichTextLeaves,
  resolvePopulateOnRead,
  validateRichTextFieldFlags,
} from './richtext-populate.js'
import type { CollectionDefinition, FieldSet, RichTextField } from '../@types/index.js'

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

describe('validateRichTextFieldFlags', () => {
  it('passes when default flags are used and adapter is registered', () => {
    expect(() => validateRichTextFieldFlags([makeCollection({})], true)).not.toThrow()
  })

  it('passes when default flags are used and no adapter is registered (snapshot mode)', () => {
    expect(() => validateRichTextFieldFlags([makeCollection({})], false)).not.toThrow()
  })

  it('throws when both flags are explicitly false', () => {
    expect(() =>
      validateRichTextFieldFlags(
        [makeCollection({ embedRelationsOnSave: false, populateRelationsOnRead: false })],
        true
      )
    ).toThrow(/both .* set to false/i)
  })

  it('throws when embedRelationsOnSave: false but no adapter is registered', () => {
    expect(() =>
      validateRichTextFieldFlags([makeCollection({ embedRelationsOnSave: false })], false)
    ).toThrow(/no.*server adapter/i)
  })

  it('throws when belt-and-braces is asked for but no adapter is registered', () => {
    expect(() =>
      validateRichTextFieldFlags(
        [makeCollection({ embedRelationsOnSave: true, populateRelationsOnRead: true })],
        false
      )
    ).toThrow(/no.*server adapter/i)
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
    expect(() => validateRichTextFieldFlags([collection], true)).toThrow(
      /content\.<photoBlock>\.caption/
    )
  })
})
