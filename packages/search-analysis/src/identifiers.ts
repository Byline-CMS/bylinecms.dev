/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchIdentifierKind } from './types.js'

export interface IdentifierSpan {
  kind: SearchIdentifierKind
  value: string
  start: number
  end: number
  /** Whether word segmentation should retain exact constituent terms. */
  preserveConstituents: boolean
}

interface IdentifierRule {
  kind: SearchIdentifierKind
  pattern: RegExp
  value?: (match: string) => string
  preserveConstituents?: boolean
}

const RULES: readonly IdentifierRule[] = [
  {
    kind: 'url',
    pattern: /https?:\/\/[^\s<>"']+/giu,
    value: trimUrlPunctuation,
  },
  {
    kind: 'email',
    pattern: /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]{1,255}\.[\p{L}]{2,63}/giu,
  },
  {
    kind: 'technical',
    pattern: /(?:^|(?<=[^\p{L}\p{N}_]))(?:c\+\+|c#|node\.js)(?=$|[^\p{L}\p{N}_])/giu,
  },
  {
    kind: 'sku',
    pattern: /\b[\p{L}]{2,}[-_]\d+\b/giu,
    preserveConstituents: true,
  },
  {
    kind: 'version',
    pattern: /\bv?\d+(?:\.\d+){1,3}(?:-[\p{L}\p{N}.-]+)?\b/giu,
    preserveConstituents: true,
  },
  {
    kind: 'mention',
    pattern: /@[\p{L}\p{M}\p{N}_]+/gu,
  },
  {
    kind: 'hashtag',
    pattern: /#[\p{L}\p{M}\p{N}_]+/gu,
  },
]

const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/u
const TRAILING_URL_BRACKETS = /[)\]}]+$/u

function trimUrlPunctuation(value: string): string {
  let trimmed = value.replace(TRAILING_URL_PUNCTUATION, '')
  while (TRAILING_URL_BRACKETS.test(trimmed)) {
    const final = trimmed.at(-1)
    const opening = final === ')' ? '(' : final === ']' ? '[' : '{'
    const closing = final
    const openingCount = [...trimmed].filter((char) => char === opening).length
    const closingCount = [...trimmed].filter((char) => char === closing).length
    if (closingCount <= openingCount) break
    trimmed = trimmed.slice(0, -1)
  }
  return trimmed
}

/**
 * Extract non-overlapping domain identifiers in rule-priority order. The input
 * is already search-normalized, so every emitted value is canonical.
 */
export function extractIdentifierSpans(text: string): IdentifierSpan[] {
  const spans: IdentifierSpan[] = []

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (const match of text.matchAll(rule.pattern)) {
      const matched = match[0]
      const matchStart = match.index
      if (matched == null || matchStart == null) continue
      const value = rule.value?.(matched) ?? matched
      if (value.length === 0) continue
      const start = matchStart
      const end = start + value.length
      if (spans.some((span) => start < span.end && end > span.start)) continue
      spans.push({
        kind: rule.kind,
        value,
        start,
        end,
        preserveConstituents: rule.preserveConstituents ?? false,
      })
    }
  }

  return spans.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** Replace identifier spans with equal-length spaces so word offsets survive. */
export function maskIdentifierSpans(text: string, spans: readonly IdentifierSpan[]): string {
  if (spans.length === 0) return text
  const characters = text.split('')
  for (const span of spans) {
    if (span.preserveConstituents) continue
    for (let index = span.start; index < span.end; index++) {
      if (characters[index] !== '\n') characters[index] = ' '
    }
  }
  return characters.join('')
}
