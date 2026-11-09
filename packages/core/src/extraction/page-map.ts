/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { everySlot } from './internal.js'

/**
 * A code for one broken page map rule.
 *
 * @provisional
 */
export type PageMapIssueCode =
  | 'invalid-shape'
  | 'invalid-version'
  | 'invalid-separator'
  | 'invalid-trailing'
  | 'invalid-offset'
  | 'surrogate-split'
  | 'invalid-page-index'
  | 'page-count-mismatch'
  | 'page-overlap'
  | 'separator-mismatch'
  | 'text-outside-ranges'
  | 'unanchored-overlap'
  | 'unanchored-before-last-page'
  | 'unanchored-after-last-page'
  | 'block-unknown-page'
  | 'block-outside-page'
  | 'block-overlap'

/**
 * One broken page map rule, and where it broke.
 *
 * @provisional
 */
export interface PageMapIssue {
  code: PageMapIssueCode
  /** For example `pages[1]`. */
  path?: string
  message: string
}

interface Range {
  charStart: number
  charEnd: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const overlaps = (a: Range, b: Range): boolean => a.charStart < b.charEnd && b.charStart < a.charEnd

function splitsSurrogatePair(text: string, boundary: number): boolean {
  if (boundary <= 0 || boundary >= text.length) return false
  const before = text.charCodeAt(boundary - 1)
  const after = text.charCodeAt(boundary)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

/**
 * Checks the structure of a page map against the exact text it describes.
 *
 * Structural validity is not provenance. Coverage does not prove that page 3's text
 * came from physical page 3; only sentinel verification against a fixture does.
 *
 * @provisional
 */
export function validatePageMap(
  plainText: string,
  map: unknown,
  options?: { pageCount?: number }
): { ok: true } | { ok: false; issues: PageMapIssue[] } {
  const issues: PageMapIssue[] = []
  const report = (code: PageMapIssueCode, message: string, path?: string): void => {
    issues.push({ code, message, ...(path != null && { path }) })
  }
  const finish = () =>
    issues.length === 0 ? { ok: true as const } : { ok: false as const, issues }

  if (!isRecord(map)) {
    report('invalid-shape', 'the page map is not an object')
    return finish()
  }

  // Rule 1: version and separator.
  if (map.version !== 1) report('invalid-version', 'version must be 1', 'version')
  const assembly = isRecord(map.assembly) ? map.assembly : {}
  const separator = assembly.pageSeparator
  if (typeof separator !== 'string') {
    report('invalid-separator', 'pageSeparator must be a string', 'assembly.pageSeparator')
  }
  const trailing = assembly.trailing
  if (trailing !== undefined && trailing !== 'embedded' && trailing !== 'none') {
    report('invalid-trailing', "trailing must be 'embedded' or 'none'", 'assembly.trailing')
  }

  const listOf = (key: string, required: boolean): Record<string, unknown>[] => {
    const value = map[key]
    if (value === undefined && !required) return []
    if (!everySlot(value, isRecord)) {
      report('invalid-shape', `${key} must be an array of objects, with no holes`, key)
      return []
    }
    return value as Record<string, unknown>[]
  }
  const rawPages = listOf('pages', true)
  const rawUnanchored = listOf('unanchored', false)
  const rawBlocks = listOf('blocks', false)

  rawPages.forEach((page, i) => {
    if (page.label !== undefined && typeof page.label !== 'string') {
      report('invalid-shape', 'a page label must be a string', `pages[${i}]`)
    }
  })
  rawUnanchored.forEach((range, i) => {
    if (typeof range.kind !== 'string') {
      report('invalid-shape', 'an unanchored range needs a string kind', `unanchored[${i}]`)
    }
  })
  rawBlocks.forEach((block, i) => {
    if (typeof block.kind !== 'string') {
      report('invalid-shape', 'a block needs a string kind', `blocks[${i}]`)
    }
  })

  // Rules 2 and 3: every offset, in every list.
  const offsetsAreValid = (entry: Record<string, unknown>, path: string): boolean => {
    const { charStart, charEnd } = entry
    if (
      !Number.isInteger(charStart) ||
      !Number.isInteger(charEnd) ||
      (charStart as number) < 0 ||
      (charStart as number) > (charEnd as number) ||
      (charEnd as number) > plainText.length
    ) {
      report('invalid-offset', 'offsets must be integers within the text, in order', path)
      return false
    }
    if (
      splitsSurrogatePair(plainText, charStart as number) ||
      splitsSurrogatePair(plainText, charEnd as number)
    ) {
      report('surrogate-split', 'a boundary splits a UTF-16 surrogate pair', path)
    }
    return true
  }
  const allOffsetsValid = [
    ...rawPages.map((entry, i) => offsetsAreValid(entry, `pages[${i}]`)),
    ...rawUnanchored.map((entry, i) => offsetsAreValid(entry, `unanchored[${i}]`)),
    ...rawBlocks.map((entry, i) => offsetsAreValid(entry, `blocks[${i}]`)),
  ].every(Boolean)

  // Rule 4: page indexes.
  let previousIndex = 0
  rawPages.forEach((page, i) => {
    const { index } = page
    if (!Number.isInteger(index) || (index as number) <= previousIndex) {
      report('invalid-page-index', 'indexes must be positive and strictly increase', `pages[${i}]`)
    }
    if (Number.isInteger(index)) previousIndex = Math.max(previousIndex, index as number)
  })
  if (options?.pageCount !== undefined) {
    const exact =
      rawPages.length === options.pageCount && rawPages.every((page, i) => page.index === i + 1)
    if (!exact) {
      report(
        'page-count-mismatch',
        `indexes must be exactly 1 to ${options.pageCount}; an empty page is a zero-length range`,
        'pages'
      )
    }
  }

  // The remaining rules compare ranges and text, so they need sound offsets.
  if (!allOffsetsValid || typeof separator !== 'string') return finish()

  const pages = rawPages as unknown as (Range & { index: number })[]
  const unanchored = rawUnanchored as unknown as Range[]
  const blocks = rawBlocks as unknown as (Range & { page: number })[]

  // Rule 5: pages are ordered and do not overlap.
  for (let i = 1; i < pages.length; i += 1) {
    const previous = pages[i - 1] as Range
    const page = pages[i] as Range
    if (page.charStart < previous.charEnd) {
      report('page-overlap', 'pages must be in text order and must not overlap', `pages[${i}]`)
    }
  }

  // Rule 8: unanchored ranges.
  unanchored.forEach((range, i) => {
    if (pages.some((page) => overlaps(range, page))) {
      report('unanchored-overlap', 'an unanchored range overlaps a page', `unanchored[${i}]`)
    }
    if (unanchored.slice(0, i).some((other) => overlaps(range, other))) {
      report('unanchored-overlap', 'unanchored ranges overlap', `unanchored[${i}]`)
    }
  })
  const lastPage = pages.at(-1)
  if (lastPage !== undefined) {
    unanchored.forEach((range, i) => {
      if (trailing === 'embedded' && range.charStart < lastPage.charEnd) {
        report(
          'unanchored-before-last-page',
          "with trailing 'embedded', unanchored ranges follow the last page",
          `unanchored[${i}]`
        )
      }
      if (trailing !== 'embedded' && range.charStart >= lastPage.charEnd) {
        report(
          'unanchored-after-last-page',
          "without trailing 'embedded', no unanchored range follows the last page",
          `unanchored[${i}]`
        )
      }
    })
  }

  // Rules 6 and 7: complete coverage, in text order across both kinds of range.
  const ranges = [...pages, ...unanchored].sort(
    (a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd
  )
  const first = ranges[0]
  const last = ranges.at(-1)
  if (first === undefined || last === undefined) {
    if (plainText.length > 0) report('text-outside-ranges', 'the text has no ranges')
  } else {
    if (first.charStart !== 0) report('text-outside-ranges', 'text precedes the first range')
    if (last.charEnd !== plainText.length) {
      report('text-outside-ranges', 'text follows the last range')
    }
  }
  for (let i = 1; i < ranges.length; i += 1) {
    const previous = ranges[i - 1] as Range
    const range = ranges[i] as Range
    // An overlap was reported above; it has no gap to compare.
    if (range.charStart < previous.charEnd) continue
    if (plainText.slice(previous.charEnd, range.charStart) !== separator) {
      report(
        'separator-mismatch',
        `the text between offsets ${previous.charEnd} and ${range.charStart} is not the separator`
      )
    }
  }

  // Rule 9: blocks.
  blocks.forEach((block, i) => {
    const page = pages.find((candidate) => candidate.index === block.page)
    const path = `blocks[${i}]`
    if (page === undefined) {
      report('block-unknown-page', `block names page ${String(block.page)}, which is absent`, path)
      return
    }
    if (block.charStart < page.charStart || block.charEnd > page.charEnd) {
      report('block-outside-page', 'a block lies outside the page it names', path)
    }
    const earlier = blocks.slice(0, i).filter((other) => other.page === block.page)
    if (earlier.some((other) => overlaps(block, other))) {
      report('block-overlap', 'blocks of one page overlap', path)
    }
  })

  return finish()
}
