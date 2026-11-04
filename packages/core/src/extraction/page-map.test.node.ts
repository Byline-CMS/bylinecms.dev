/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { type PageMapIssueCode, validatePageMap } from './page-map.js'
import type { PageMapV1 } from '../@types/extraction-types.js'

// "alpha" + "\n\n" + "beta" + "\n\n" + "gamma"
const TEXT = 'alpha\n\nbeta\n\ngamma'

function validMap(): PageMapV1 {
  return {
    version: 1,
    assembly: { pageSeparator: '\n\n' },
    pages: [
      { index: 1, charStart: 0, charEnd: 5 },
      { index: 2, charStart: 7, charEnd: 11 },
      { index: 3, charStart: 13, charEnd: 18 },
    ],
  }
}

function codes(plainText: string, map: unknown, options?: { pageCount?: number }) {
  const result = validatePageMap(plainText, map, options)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

function expectIssue(
  code: PageMapIssueCode,
  plainText: string,
  map: unknown,
  options?: { pageCount?: number }
) {
  expect(codes(plainText, map, options)).toContain(code)
}

describe('validatePageMap', () => {
  it('accepts a complete map', () => {
    expect(validatePageMap(TEXT, validMap(), { pageCount: 3 })).toEqual({ ok: true })
  })

  it('accepts a label, blocks and a declared trailing mode', () => {
    const map = validMap()
    map.assembly.trailing = 'none'
    map.pages[0] = { index: 1, label: 'i', charStart: 0, charEnd: 5 }
    map.blocks = [
      { page: 1, charStart: 0, charEnd: 2, kind: 'heading' },
      { page: 1, charStart: 2, charEnd: 5, kind: 'paragraph' },
    ]

    expect(validatePageMap(TEXT, map)).toEqual({ ok: true })
  })

  it('accepts an empty page as a zero-length range', () => {
    const map: PageMapV1 = {
      version: 1,
      assembly: { pageSeparator: '\n\n' },
      pages: [
        { index: 1, charStart: 0, charEnd: 2 },
        { index: 2, charStart: 4, charEnd: 4 },
        { index: 3, charStart: 6, charEnd: 8 },
      ],
    }

    expect(validatePageMap('ab\n\n\n\ncd', map, { pageCount: 3 })).toEqual({ ok: true })
  })

  it('accepts empty text with no pages', () => {
    const map: PageMapV1 = { version: 1, assembly: { pageSeparator: '' }, pages: [] }

    expect(validatePageMap('', map)).toEqual({ ok: true })
  })

  it('accepts embedded text after the last page', () => {
    const plainText = 'alpha\n\nextra'
    const map: PageMapV1 = {
      version: 1,
      assembly: { pageSeparator: '\n\n', trailing: 'embedded' },
      pages: [{ index: 1, charStart: 0, charEnd: 5 }],
      unanchored: [{ kind: 'embedded', charStart: 7, charEnd: 12 }],
    }

    expect(validatePageMap(plainText, map, { pageCount: 1 })).toEqual({ ok: true })
  })

  it('accepts an unanchored range between pages when no trailing mode is embedded', () => {
    const plainText = 'a\n\nnote\n\nb'
    const map: PageMapV1 = {
      version: 1,
      assembly: { pageSeparator: '\n\n' },
      pages: [
        { index: 1, charStart: 0, charEnd: 1 },
        { index: 2, charStart: 9, charEnd: 10 },
      ],
      unanchored: [{ kind: 'note', charStart: 3, charEnd: 7 }],
    }

    expect(validatePageMap(plainText, map)).toEqual({ ok: true })
  })

  describe('rule 1: version and separator', () => {
    it('rejects another version', () => {
      expectIssue('invalid-version', TEXT, { ...validMap(), version: 2 })
    })

    it('rejects a missing separator', () => {
      expectIssue('invalid-separator', TEXT, { ...validMap(), assembly: {} })
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an array', []],
      ['pages that are not an array', { ...validMap(), pages: 'nope' }],
    ])('rejects a map that is %s as malformed', (_label, map) => {
      expect(codes(TEXT, map).length).toBeGreaterThan(0)
    })

    it('rejects an unknown trailing mode', () => {
      expectIssue('invalid-trailing', TEXT, {
        ...validMap(),
        assembly: { pageSeparator: '\n\n', trailing: 'sometimes' },
      })
    })
  })

  describe('rule 2: offsets', () => {
    it.each([
      ['a fractional offset', 1.5, 5],
      ['a negative offset', -1, 5],
      ['an end past the text', 0, 99],
      ['a start after its end', 5, 2],
      ['a string offset', '0', 5],
    ])('rejects %s', (_label, charStart, charEnd) => {
      const map = validMap() as unknown as { pages: Array<Record<string, unknown>> }
      map.pages[0] = { index: 1, charStart, charEnd }

      expectIssue('invalid-offset', TEXT, map)
    })

    it('checks unanchored and block offsets too', () => {
      expectIssue('invalid-offset', TEXT, {
        ...validMap(),
        unanchored: [{ kind: 'x', charStart: 99, charEnd: 100 }],
      })
      expectIssue('invalid-offset', TEXT, {
        ...validMap(),
        blocks: [{ page: 1, charStart: 4, charEnd: 2, kind: 'x' }],
      })
    })
  })

  describe('rule 3: surrogate pairs', () => {
    const EMOJI_TEXT = 'a\u{1F600}b'

    it('rejects a boundary inside a surrogate pair', () => {
      expectIssue('surrogate-split', EMOJI_TEXT, {
        version: 1,
        assembly: { pageSeparator: '' },
        pages: [
          { index: 1, charStart: 0, charEnd: 2 },
          { index: 2, charStart: 2, charEnd: 4 },
        ],
      })
    })

    it('accepts boundaries around a whole pair', () => {
      const map: PageMapV1 = {
        version: 1,
        assembly: { pageSeparator: '' },
        pages: [
          { index: 1, charStart: 0, charEnd: 3 },
          { index: 2, charStart: 3, charEnd: 4 },
        ],
      }

      expect(validatePageMap(EMOJI_TEXT, map)).toEqual({ ok: true })
    })
  })

  describe('rule 4: page indexes', () => {
    it.each([
      ['zero', 0],
      ['a negative index', -1],
      ['a fractional index', 1.5],
    ])('rejects %s', (_label, index) => {
      const map = validMap()
      map.pages[0] = { index, charStart: 0, charEnd: 5 }

      expectIssue('invalid-page-index', TEXT, map)
    })

    it('rejects indexes that do not strictly increase', () => {
      const map = validMap()
      map.pages[1] = { index: 1, charStart: 7, charEnd: 11 }

      expectIssue('invalid-page-index', TEXT, map)
    })

    it('rejects a gap against pageCount, because an empty page must still have an entry', () => {
      const map: PageMapV1 = {
        version: 1,
        assembly: { pageSeparator: '\n\n' },
        pages: [
          { index: 1, charStart: 0, charEnd: 5 },
          { index: 3, charStart: 7, charEnd: 11 },
          { index: 4, charStart: 13, charEnd: 18 },
        ],
      }

      expectIssue('page-count-mismatch', TEXT, map, { pageCount: 3 })
    })

    it('rejects too few pages against pageCount', () => {
      expectIssue('page-count-mismatch', TEXT, validMap(), { pageCount: 4 })
    })
  })

  describe('rule 5: page order', () => {
    it('rejects overlapping pages', () => {
      const map = validMap()
      map.pages[1] = { index: 2, charStart: 3, charEnd: 11 }

      expectIssue('page-overlap', TEXT, map)
    })

    it('rejects pages whose offsets run backwards', () => {
      const map: PageMapV1 = {
        version: 1,
        assembly: { pageSeparator: '\n\n' },
        pages: [
          { index: 1, charStart: 7, charEnd: 11 },
          { index: 2, charStart: 0, charEnd: 5 },
        ],
      }

      expectIssue('page-overlap', TEXT, map)
    })
  })

  describe('rule 6: separators', () => {
    it('rejects a gap that differs from the declared separator', () => {
      expectIssue('separator-mismatch', TEXT, {
        ...validMap(),
        assembly: { pageSeparator: '\f' },
      })
    })

    it('rejects text that a page range skipped', () => {
      const map = validMap()
      map.pages[1] = { index: 2, charStart: 8, charEnd: 11 }

      expectIssue('separator-mismatch', TEXT, map)
    })

    it('checks the gap between a page and an unanchored range', () => {
      const plainText = 'alpha--extra'

      expectIssue('separator-mismatch', plainText, {
        version: 1,
        assembly: { pageSeparator: '\n\n', trailing: 'embedded' },
        pages: [{ index: 1, charStart: 0, charEnd: 5 }],
        unanchored: [{ kind: 'embedded', charStart: 7, charEnd: 12 }],
      })
    })
  })

  describe('rule 7: complete coverage', () => {
    it('rejects text before the first range', () => {
      const map = validMap()
      map.pages[0] = { index: 1, charStart: 1, charEnd: 5 }

      expectIssue('text-outside-ranges', TEXT, map)
    })

    it('rejects text after the last range', () => {
      const map = validMap()
      map.pages[2] = { index: 3, charStart: 13, charEnd: 17 }

      expectIssue('text-outside-ranges', TEXT, map)
    })

    it('rejects text with no ranges at all', () => {
      expectIssue('text-outside-ranges', 'alpha', {
        version: 1,
        assembly: { pageSeparator: '' },
        pages: [],
      })
    })
  })

  describe('rule 8: unanchored ranges', () => {
    it('rejects an unanchored range that overlaps a page', () => {
      expectIssue('unanchored-overlap', TEXT, {
        ...validMap(),
        unanchored: [{ kind: 'x', charStart: 2, charEnd: 4 }],
      })
    })

    it('rejects a zero-length unanchored range inside a page', () => {
      expectIssue('unanchored-overlap', TEXT, {
        ...validMap(),
        unanchored: [{ kind: 'x', charStart: 2, charEnd: 2 }],
      })
    })

    it('rejects unanchored ranges that overlap each other', () => {
      const plainText = 'alpha\n\nextra'

      expectIssue('unanchored-overlap', plainText, {
        version: 1,
        assembly: { pageSeparator: '\n\n', trailing: 'embedded' },
        pages: [{ index: 1, charStart: 0, charEnd: 5 }],
        unanchored: [
          { kind: 'a', charStart: 7, charEnd: 10 },
          { kind: 'b', charStart: 9, charEnd: 12 },
        ],
      })
    })

    it('rejects an embedded range before the last page', () => {
      const plainText = 'a\n\nnote\n\nb'

      expectIssue('unanchored-before-last-page', plainText, {
        version: 1,
        assembly: { pageSeparator: '\n\n', trailing: 'embedded' },
        pages: [
          { index: 1, charStart: 0, charEnd: 1 },
          { index: 2, charStart: 9, charEnd: 10 },
        ],
        unanchored: [{ kind: 'note', charStart: 3, charEnd: 7 }],
      })
    })

    it.each([
      ['none', 'none'],
      ['absent', undefined],
    ])('rejects a range after the last page when trailing is %s', (_label, trailing) => {
      const plainText = 'alpha\n\nextra'

      expectIssue('unanchored-after-last-page', plainText, {
        version: 1,
        assembly: { pageSeparator: '\n\n', ...(trailing != null && { trailing }) },
        pages: [{ index: 1, charStart: 0, charEnd: 5 }],
        unanchored: [{ kind: 'x', charStart: 7, charEnd: 12 }],
      })
    })
  })

  describe('rule 9: blocks', () => {
    it('rejects a block outside the page it names', () => {
      expectIssue('block-outside-page', TEXT, {
        ...validMap(),
        blocks: [{ page: 1, charStart: 7, charEnd: 9, kind: 'x' }],
      })
    })

    it('rejects a block naming a page that does not exist', () => {
      expectIssue('block-unknown-page', TEXT, {
        ...validMap(),
        blocks: [{ page: 9, charStart: 0, charEnd: 2, kind: 'x' }],
      })
    })

    it('rejects overlapping blocks on one page', () => {
      expectIssue('block-overlap', TEXT, {
        ...validMap(),
        blocks: [
          { page: 1, charStart: 0, charEnd: 3, kind: 'a' },
          { page: 1, charStart: 2, charEnd: 5, kind: 'b' },
        ],
      })
    })
  })

  describe('sparse lists', () => {
    const filled = { index: 1, charStart: 0, charEnd: 5 }
    const page2 = { index: 2, charStart: 7, charEnd: 11 }
    const pagesWithHole = [filled]
    pagesWithHole[2] = page2

    it.each([
      ['pages of only holes', { pages: new Array(1) }],
      ['pages with a hole between entries', { pages: pagesWithHole }],
      ['a very long sparse pages array', { pages: new Array(2 ** 32 - 1) }],
      ['unanchored holes', { pages: [filled], unanchored: new Array(1) }],
      ['block holes', { pages: [filled], blocks: new Array(1) }],
    ])('returns a structured failure for %s', (_label, change) => {
      const map = { version: 1, assembly: { pageSeparator: '\n\n' }, ...change }

      expect(codes('uncovered text', map, { pageCount: 1 })).toContain('invalid-shape')
    })
  })

  it('records an issue whenever it stops before the coverage checks', () => {
    const result = validatePageMap('text', { version: 1, assembly: {}, pages: [] })

    expect(result.ok).toBe(false)
  })

  describe('member types', () => {
    it('rejects a non-string label', () => {
      const map = validMap() as unknown as { pages: Array<Record<string, unknown>> }
      map.pages[0] = { index: 1, label: 1, charStart: 0, charEnd: 5 }

      expectIssue('invalid-shape', TEXT, map)
    })

    it('requires a string kind on an unanchored range', () => {
      expectIssue('invalid-shape', 'alpha\n\nextra', {
        version: 1,
        assembly: { pageSeparator: '\n\n', trailing: 'embedded' },
        pages: [{ index: 1, charStart: 0, charEnd: 5 }],
        unanchored: [{ charStart: 7, charEnd: 12 }],
      })
    })

    it('requires a string kind on a block', () => {
      expectIssue('invalid-shape', TEXT, {
        ...validMap(),
        blocks: [{ page: 1, charStart: 0, charEnd: 2, kind: 3 }],
      })
    })
  })

  it('reports where an issue is', () => {
    const map = validMap()
    map.pages[1] = { index: 2, charStart: 99, charEnd: 100 }

    const result = validatePageMap(TEXT, map)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({ code: 'invalid-offset', path: 'pages[1]' })
    }
  })

  it('treats structural validity as the only claim: shifted pages with matching text pass', () => {
    // Coverage is complete, yet nothing here proves "gamma" came from physical
    // page 3. Only sentinel verification against a fixture can do that.
    const shifted = 'gamma\n\nbeta\n\nalpha'

    expect(validatePageMap(shifted, validMap(), { pageCount: 3 })).toEqual({ ok: true })
  })
})
