/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { getLogger } from '../lib/logger.js'
import { applyPatches } from '../patches/apply-patches.js'
import { validateDocumentFields } from '../validation/document-fields.js'
import { flattenFieldSetData } from './storage-flatten.js'
import { restoreFieldSetData } from './storage-restore.js'
import type { BlocksField, FieldSet, MultiCollectionDefinition } from '../@types/index.js'

const logger = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../lib/logger.js', () => ({ getLogger: () => logger }))

const live = { blockType: 'live', fields: [{ name: 'text', type: 'text' as const }] }
const retired = { ...live, blockType: 'retired' }
const blocks = (optional = false): BlocksField => ({
  name: 'content',
  type: 'blocks',
  optional,
  blocks: [live, retired],
})
const item = (_type: string, i: number) => ({ _id: `item-${i}`, _type, text: `${_type}-${i}` })

describe('unavailable blocks', () => {
  for (const optional of [false, true]) {
    for (const types of [
      ['retired', 'live'],
      ['live', 'retired', 'live'],
      ['live', 'retired'],
      ['retired'],
      ['retired', 'retired', 'live'],
    ]) {
      it(`compacts ${types.join(',')} (optional=${optional}) with an independent report`, () => {
        const before = [blocks(optional)]
        const after = [{ ...blocks(optional), blocks: [live] }]
        const original = { content: types.map(item) }
        const rows = flattenFieldSetData(before, original, 'en')
        const restored = restoreFieldSetData(after, rows, 'en')
        expect(restored.warnings).toEqual([])
        expect(restored.unavailableBlocks).toEqual(
          types.flatMap((type, storedIndex) =>
            type === 'retired'
              ? [{ fieldPath: 'content', storedIndex, blockType: type, id: `item-${storedIndex}` }]
              : []
          )
        )
        expect(restored.data.content).toEqual(
          original.content.filter((item) => item._type === 'live')
        )
        for (const data of [restored.data, JSON.parse(JSON.stringify(restored.data))]) {
          expect(validateDocumentFields(after, data)).toEqual([])
          const saved = restoreFieldSetData(after, flattenFieldSetData(after, data, 'en'), 'en')
          expect(saved.unavailableBlocks).toEqual([])
          expect(saved.data.content ?? []).toEqual(restored.data.content)
        }
      })
    }
  }

  it('reports groups, arrays and nested blocks using compacted parent indices', () => {
    const before: FieldSet = [
      { name: 'group', type: 'group', fields: [blocks()] },
      { name: 'sections', type: 'array', fields: [blocks()] },
      {
        name: 'outer',
        type: 'blocks',
        blocks: [retired, { blockType: 'container', fields: [blocks()] }],
      },
    ]
    const after: FieldSet = [
      { name: 'group', type: 'group', fields: [{ ...blocks(), blocks: [live] }] },
      { name: 'sections', type: 'array', fields: [{ ...blocks(), blocks: [live] }] },
      {
        name: 'outer',
        type: 'blocks',
        blocks: [{ blockType: 'container', fields: [{ ...blocks(), blocks: [live] }] }],
      },
    ]
    const content = [item('retired', 0), item('live', 1)]
    const rows = flattenFieldSetData(
      before,
      {
        group: { content },
        sections: [{ content }],
        outer: [item('retired', 0), { _type: 'container', content }],
      },
      'en'
    )
    const result = restoreFieldSetData(after, rows.reverse(), 'en')
    expect(result.unavailableBlocks.map((issue) => issue.fieldPath)).toEqual([
      'group.content',
      'sections[0].content',
      'outer',
      'outer[0].content',
    ])
    expect(result.warnings).toEqual([])
    expect(result.data.outer[0].content).toEqual([item('live', 1)])
  })

  it('applies a positional patch to a surviving block after the missing card', () => {
    const before = [blocks()]
    const after = [{ ...blocks(), blocks: [live] }]
    const source = { content: ['retired', 'live', 'live'].map(item) }
    const { data } = restoreFieldSetData(after, flattenFieldSetData(before, source, 'en'))
    const definition: MultiCollectionDefinition = {
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: after,
    }
    const patched = applyPatches(definition, data, [
      { kind: 'field.set', path: 'content[1].text', value: 'edited' },
    ])
    expect(patched.errors).toEqual([])
    const saved = restoreFieldSetData(after, flattenFieldSetData(after, patched.doc, 'en'))
    expect(saved.data.content.map((item: any) => [item._id, item.text])).toEqual([
      ['item-1', 'live-1'],
      ['item-2', 'edited'],
    ])
  })

  it.each([new Array(1), [null], [undefined], [42], [[]]].map((content) => ({ content })))(
    'rejects malformed items without a destructure crash: $content',
    ({ content }) => {
      expect(validateDocumentFields([blocks()], { content })).not.toEqual([])
      expect(() => flattenFieldSetData([blocks()], { content }, 'en')).toThrow(
        /Block item is missing or must be an object/
      )
    }
  )

  it('logs once per document version without adding a strict-read warning', () => {
    const spy = vi.spyOn(getLogger(), 'warn').mockImplementation(() => {})
    try {
      const rows = flattenFieldSetData([blocks()], { content: [item('retired', 0)] }, 'en')
      const identity = { collectionPath: 'pages', documentId: crypto.randomUUID(), versionId: 'v1' }
      for (let i = 0; i < 2; i++)
        expect(
          restoreFieldSetData([{ ...blocks(), blocks: [live] }], rows, 'en', identity).warnings
        ).toEqual([])
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith({ ...identity, blockTypes: ['retired'] }, expect.any(String))
      restoreFieldSetData([{ ...blocks(), blocks: [live] }], rows, 'en', {
        ...identity,
        versionId: 'v2',
      })
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})
