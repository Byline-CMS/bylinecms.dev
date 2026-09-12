import { describe, expect, it } from 'vitest'

import { resolveListViewState } from '../server-fns/collections/list-view-state.js'
import { collectionListSearchSchema, decodeListReturnState } from './list-return-state.js'
import { searchBooleanSchema } from './search-boolean.js'

describe('search booleans', () => {
  it.each([
    [true, true],
    [false, false],
    ['true', true],
    ['false', false],
    [undefined, undefined],
  ])('parses %s as %s', (input, expected) => {
    expect(searchBooleanSchema.parse(input)).toBe(expected)
  })

  it.each(['invalid', '', ['false'], null, 0, 1])('rejects ambiguous input %s', (input) => {
    expect(searchBooleanSchema.safeParse(input).success).toBe(false)
  })

  it.each(['true', 'false'])('carries desc=%s from wire params into the list query', (desc) => {
    const params = collectionListSearchSchema.parse(
      Object.fromEntries(new URLSearchParams(`order=title&desc=${desc}`))
    )
    const result = resolveListViewState({
      params,
      preference: null,
      orderable: false,
      sortableFields: ['title'],
    })
    expect(result.sort).toEqual({ title: desc === 'true' ? 'desc' : 'asc' })
    expect(result.metaDesc).toBe(desc === 'true')
  })

  it('rejects a malformed return direction instead of silently changing it to ascending', () => {
    expect(decodeListReturnState('order=title&desc=invalid')).toBeUndefined()
  })
})
