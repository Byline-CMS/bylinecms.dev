/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { get, hasExistingIdTargets, set, setWithResult, toPath } from './nested-path'

describe('toPath', () => {
  it('parses dot and bracket notation', () => {
    expect(toPath('title')).toEqual(['title'])
    expect(toPath('a.b.c')).toEqual(['a', 'b', 'c'])
    expect(toPath('items[0].title')).toEqual(['items', '0', 'title'])
    expect(toPath('blocks[2].nested[1].field')).toEqual(['blocks', '2', 'nested', '1', 'field'])
  })
})

describe('get', () => {
  const obj = { a: { b: 1, zero: 0, empty: '' }, items: [{ title: 'x' }, { title: 'y' }] }

  it('reads nested, array, and mixed paths', () => {
    expect(get(obj, 'a.b')).toBe(1)
    expect(get(obj, 'items[0].title')).toBe('x')
    expect(get(obj, 'items[1].title')).toBe('y')
  })

  it('selects nested repeating items by stable id', () => {
    const value = {
      content: [
        {
          _id: 'block-b',
          gallery: [
            { _id: 'image-1', alt: 'one' },
            { _id: 'image-2', alt: 'two' },
          ],
        },
      ],
    }
    expect(get(value, 'content[id=block-b].gallery[id=image-2].alt')).toBe('two')
    expect(get(value, 'content[id=missing].gallery[id=image-2].alt')).toBeUndefined()
  })

  it('preserves falsy values (does not conflate with missing)', () => {
    expect(get(obj, 'a.zero')).toBe(0)
    expect(get(obj, 'a.empty')).toBe('')
  })

  it('returns undefined for missing paths or nullish roots', () => {
    expect(get(obj, 'a.x')).toBeUndefined()
    expect(get(obj, 'missing.deep.path')).toBeUndefined()
    expect(get(obj, 'items[5].title')).toBeUndefined()
    expect(get(null, 'a.b')).toBeUndefined()
    expect(get(undefined, 'a.b')).toBeUndefined()
  })
})

describe('set', () => {
  it('sets simple and nested values, creating intermediate objects', () => {
    const o: any = {}
    set(o, 'a.b.c', 1)
    expect(o).toEqual({ a: { b: { c: 1 } } })
  })

  it('creates arrays for numeric index segments', () => {
    const o: any = {}
    set(o, 'items[0].title', 'x')
    expect(Array.isArray(o.items)).toBe(true)
    expect(o.items[0]).toEqual({ title: 'x' })
  })

  it('handles deep, mixed array/object paths', () => {
    const o: any = {}
    set(o, 'blocks[1].nested[0].field', 42)
    expect(Array.isArray(o.blocks)).toBe(true)
    expect(Array.isArray(o.blocks[1].nested)).toBe(true)
    expect(o.blocks[1].nested[0].field).toBe(42)
  })

  it('overwrites existing values and preserves siblings', () => {
    const o: any = { a: { b: 1, keep: 2 } }
    set(o, 'a.b', 9)
    expect(o).toEqual({ a: { b: 9, keep: 2 } })
  })

  it('writes into a pre-existing array element without clobbering the array', () => {
    const o: any = { items: [{ title: 'x' }, { title: 'y' }] }
    set(o, 'items[1].title', 'z')
    expect(o.items[1].title).toBe('z')
    expect(o.items[0].title).toBe('x')
    expect(Array.isArray(o.items)).toBe(true)
  })

  it('writes through nested stable-id selectors without changing array order', () => {
    const o = {
      content: [
        { _id: 'a', gallery: [{ _id: 'x', alt: 'keep' }] },
        { _id: 'b', gallery: [{ _id: 'y', alt: 'old' }] },
      ],
    }
    set(o, 'content[id=b].gallery[id=y].alt', 'new')
    expect(o.content.map((item) => item._id)).toEqual(['a', 'b'])
    expect(o.content[0]?.gallery[0]?.alt).toBe('keep')
    expect(o.content[1]?.gallery[0]?.alt).toBe('new')
  })

  it('does not create a ghost item for an unknown stable id', () => {
    const o = { items: [{ _id: 'a', title: 'keep' }] }
    expect(setWithResult(o, 'items[id=gone].title', 'new')).toBe(false)
    expect(o).toEqual({ items: [{ _id: 'a', title: 'keep' }] })

    const missingContainer: { group: { items?: unknown[] } } = { group: {} }
    expect(setWithResult(missingContainer, 'group.items[id=gone].title', 'new')).toBe(false)
    expect(missingContainer).toEqual({ group: {} })
  })

  it('returns the mutated root', () => {
    const o: any = {}
    expect(set(o, 'x', 1)).toBe(o)
  })
})

describe('hasExistingIdTargets', () => {
  const value = { items: [{ _id: 'a', nested: [{ _id: 'b' }] }] }

  it('accepts live nested identities and rejects removed ones', () => {
    expect(hasExistingIdTargets(value, 'items[id=a].nested[id=b].title')).toBe(true)
    expect(hasExistingIdTargets(value, 'items[id=a].nested[id=gone].title')).toBe(false)
    expect(hasExistingIdTargets(value, 'title')).toBe(true)
  })
})
