import { describe, expect, it } from 'vitest'

import { moveRepeatingItems, repeatingItemId, repeatingItemPath } from './repeating-items'

describe('repeatingItemPath', () => {
  it('uses stable storage identity when available', () => {
    expect(repeatingItemPath('content', { _id: 'block-b' }, 1)).toBe('content[id=block-b]')
  })

  it('falls back to position for id-less or path-unsafe identities', () => {
    expect(repeatingItemPath('content', {}, 1)).toBe('content[1]')
    expect(repeatingItemPath('content', { _id: 'unsafe.id' }, 1)).toBe('content[1]')
    expect(repeatingItemPath('content', { _id: null }, 1)).toBe('content[1]')
    expect(repeatingItemId({ _id: 42 })).toBeUndefined()
  })
})

describe('moveRepeatingItems', () => {
  const ids = (items: { _id: string }[]) => items.map((item) => item._id)

  it('keeps consecutive moves aligned with the current form-store order', () => {
    const first = moveRepeatingItems([{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }], 2, 0)
    expect(first?.itemId).toBe('c')
    expect(ids(first?.items ?? [])).toEqual(['c', 'a', 'b'])

    const second = moveRepeatingItems(first?.items ?? [], 2, 1)
    expect(second?.itemId).toBe('b')
    expect(ids(second?.items ?? [])).toEqual(['c', 'b', 'a'])
  })

  it('retains the positional patch fallback for id-less items', () => {
    const moved = moveRepeatingItems([{ value: 'a' }, { value: 'b' }], 1, 0)
    expect(moved?.itemId).toBe('1')
    expect(moved?.items.map((item) => item.value)).toEqual(['b', 'a'])
  })
})
