/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Which editor the capability manifest measures for each richtext field.
 *
 * Resolving this wrongly is silent and dangerous: measuring a block
 * field against the collection's map, or against the global editor,
 * reports capabilities BROADER than the field really has, and a scan
 * built on that calls affected documents clean.
 */

import { describe, expect, it } from 'vitest'

import { collectRichTextTargets } from '../lib/richtext-capability-targets.js'

const GlobalEditor = () => null
const CaptionEditor = () => null
const AnswerEditor = () => null
const TitleEditor = () => null

const config = {
  fields: { richText: { editor: GlobalEditor } },
  collections: [
    {
      path: 'pages',
      fields: [
        { name: 'title', type: 'richText', label: 'Title' },
        { name: 'body', type: 'richText', label: 'Body' },
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
              blockType: 'faqBlock',
              fields: [
                {
                  name: 'faq',
                  type: 'array',
                  label: 'FAQ',
                  fields: [{ name: 'answer', type: 'richText', label: 'Answer' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  admin: [{ path: 'pages', fields: { title: { editor: TitleEditor } } }],
  blockAdmin: [
    { blockType: 'photoBlock', fields: { caption: { editor: CaptionEditor } } },
    { blockType: 'faqBlock', fields: { 'faq.answer': { editor: AnswerEditor } } },
  ],
}

function targetFor(fieldPath: string) {
  const found = collectRichTextTargets(config).find((target) => target.fieldPath === fieldPath)
  if (found == null) throw new Error(`no target for ${fieldPath}`)
  return found
}

describe('collectRichTextTargets', () => {
  it('finds every richtext field, including ones nested in blocks and arrays', () => {
    expect(
      collectRichTextTargets(config)
        .map((target) => target.fieldPath)
        .sort()
    ).toEqual(['body', 'content.faqBlock.faq.answer', 'content.photoBlock.caption', 'title'])
  })

  it('uses the collection override for a top-level field', () => {
    const target = targetFor('title')
    expect(target.Editor).toBe(TitleEditor)
    expect(target.resolvedFrom).toBe('collection')
  })

  it('falls back to the global editor when nothing overrides', () => {
    const target = targetFor('body')
    expect(target.Editor).toBe(GlobalEditor)
    expect(target.resolvedFrom).toBe('global')
  })

  it('uses the blockAdmin registry for a field inside a block', () => {
    // Not the collection map and not the global editor: blocks are
    // cross-collection units, so BlocksField resolves their fields from
    // the blockType-keyed registry.
    const target = targetFor('content.photoBlock.caption')
    expect(target.Editor).toBe(CaptionEditor)
    expect(target.Editor).not.toBe(GlobalEditor)
    expect(target.resolvedFrom).toBe('blockAdmin:photoBlock')
  })

  it('uses the blockAdmin key for a field inside an array inside a block', () => {
    // The registry key is the path WITHIN the block — `faq.answer` —
    // not the full declaration path.
    const target = targetFor('content.faqBlock.faq.answer')
    expect(target.Editor).toBe(AnswerEditor)
    expect(target.resolvedFrom).toBe('blockAdmin:faqBlock')
  })

  it('reports a field with no editor rather than omitting it', () => {
    const withoutGlobal = { ...config, fields: {}, blockAdmin: [], admin: [] }
    const targets = collectRichTextTargets(withoutGlobal)
    expect(targets).toHaveLength(4)
    for (const target of targets) {
      expect(target.Editor).toBeUndefined()
      expect(target.unresolvedReason).toBeDefined()
    }
  })
})
