/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { encodeSqlToken } from './sql-token-codec.js'
import type {
  LogicalToken,
  PortableQueryPlan,
  PortableSearchAnalyzer,
  QueryConcept,
} from './types.js'

const DEFAULT_MAX_FRAGMENTS = 2
const DEFAULT_MAX_WORDS = 24

export interface PortableHighlightOptions {
  /** Maximum independently selected fragments. Defaults to 2. */
  maxFragments?: number
  /** Maximum analyzed source terms in each snippet. Defaults to 24. */
  maxWords?: number
}

export interface HighlightPortableTextInput extends PortableHighlightOptions {
  /** Original stored text from which source-preserving fragments are selected. */
  text: string
  /** Query plan produced by the same analyzer used for the index. */
  plan: PortableQueryPlan
  /** Analyzer used to recover source offsets from the stored text. */
  analyzer: PortableSearchAnalyzer
}

interface TextRange {
  start: number
  end: number
}

interface Fragment extends TextRange {
  matches: number
}

/**
 * Build a backend-neutral matched snippet from portable logical-token offsets.
 *
 * The returned string contains `<mark>…</mark>` delimiters. Consumers must
 * parse those delimiters and render the surrounding source text as text; they
 * must not inject the complete result as trusted HTML.
 */
export function highlightPortableText({
  text,
  plan,
  analyzer,
  maxFragments = DEFAULT_MAX_FRAGMENTS,
  maxWords = DEFAULT_MAX_WORDS,
}: HighlightPortableTextInput): string | undefined {
  assertPositiveInteger(maxFragments, 'maxFragments')
  assertPositiveInteger(maxWords, 'maxWords')
  if (text.length === 0 || plan.concepts.length === 0) return undefined
  if (plan.analyzerFingerprint !== analyzer.fingerprint) {
    throw new TypeError('Portable highlight plan and analyzer fingerprints do not match')
  }

  const queryTerms = new Set(queryTokens(plan).map((token) => encodeSqlToken(token)))
  const analyzed = analyzer.analyzeText({ text, locale: plan.locale })
  const matches = mergeRanges(
    analyzed.tokens
      .filter((token) => queryTerms.has(encodeSqlToken(token)))
      .map(({ start, end }) => ({ start, end }))
  )
  if (matches.length === 0) return undefined

  const sourceTerms = logicalSourceRanges([...analyzed.exactTokens, ...analyzed.identifierTokens])
  const fragments = selectFragments(text, matches, sourceTerms, maxFragments, maxWords)
  if (fragments.length === 0) return undefined

  const rendered = fragments.map((fragment) => renderFragment(text, fragment, matches))
  let snippet = rendered.join(' … ')
  if (text.slice(0, fragments[0]?.start ?? 0).trim().length > 0) snippet = `… ${snippet}`
  if (text.slice(fragments.at(-1)?.end ?? text.length).trim().length > 0) snippet += ' …'
  return snippet
}

function logicalSourceRanges(tokens: readonly LogicalToken[]): TextRange[] {
  const byPosition = new Map<number, TextRange>()
  for (const token of tokens.toSorted(compareTokenRanges)) {
    const current = byPosition.get(token.position)
    if (current == null) {
      byPosition.set(token.position, { start: token.start, end: token.end })
      continue
    }
    current.start = Math.min(current.start, token.start)
    current.end = Math.max(current.end, token.end)
  }
  return [...byPosition.values()].toSorted(compareRanges)
}

function queryTokens(plan: PortableQueryPlan): LogicalToken[] {
  return [...plan.concepts.flatMap(conceptTokens), ...plan.gramSequences.flat()]
}

function conceptTokens(concept: QueryConcept): LogicalToken[] {
  return [
    ...concept.exactTokens,
    ...concept.stemTokens,
    ...concept.lemmaTokens,
    ...concept.normalizedTokens,
    ...concept.identifierTokens,
    ...concept.gramTokens,
  ]
}

function selectFragments(
  text: string,
  matches: readonly TextRange[],
  sourceTerms: readonly TextRange[],
  maxFragments: number,
  maxWords: number
): Fragment[] {
  const candidates = uniqueRanges(
    matches.map((match) => fragmentAroundMatch(text, match, sourceTerms, maxWords))
  )
    .map((range) => ({
      ...range,
      matches: matches.filter((match) => overlaps(range, match)).length,
    }))
    .toSorted((left, right) => right.matches - left.matches || left.start - right.start)

  const selected: Fragment[] = []
  for (const candidate of candidates) {
    if (selected.some((fragment) => overlaps(fragment, candidate))) continue
    selected.push(candidate)
    if (selected.length === maxFragments) break
  }
  return selected.toSorted((left, right) => left.start - right.start)
}

function fragmentAroundMatch(
  text: string,
  match: TextRange,
  sourceTerms: readonly TextRange[],
  maxWords: number
): TextRange {
  const firstMatch = sourceTerms.findIndex((term) => overlaps(term, match))
  if (firstMatch === -1) return match

  let lastMatch = firstMatch
  while (lastMatch + 1 < sourceTerms.length && overlaps(sourceTerms[lastMatch + 1]!, match)) {
    lastMatch += 1
  }

  const matchedWords = lastMatch - firstMatch + 1
  const contextWords = Math.max(0, maxWords - matchedWords)
  let first = Math.max(0, firstMatch - Math.floor(contextWords / 2))
  let last = Math.min(sourceTerms.length - 1, lastMatch + Math.ceil(contextWords / 2))

  const currentWords = last - first + 1
  if (currentWords < maxWords) {
    const missing = maxWords - currentWords
    const extendLeft = Math.min(first, missing)
    first -= extendLeft
    last = Math.min(sourceTerms.length - 1, last + missing - extendLeft)
  }

  return {
    start: first === 0 ? 0 : (sourceTerms[first]?.start ?? match.start),
    end: last === sourceTerms.length - 1 ? text.length : (sourceTerms[last]?.end ?? match.end),
  }
}

function renderFragment(text: string, fragment: TextRange, matches: readonly TextRange[]): string {
  const included = matches
    .filter((match) => overlaps(fragment, match))
    .map((match) => ({
      start: Math.max(fragment.start, match.start),
      end: Math.min(fragment.end, match.end),
    }))

  let cursor = fragment.start
  let rendered = ''
  for (const match of included) {
    rendered += text.slice(cursor, match.start)
    rendered += `<mark>${text.slice(match.start, match.end)}</mark>`
    cursor = match.end
  }
  rendered += text.slice(cursor, fragment.end)
  return rendered.trim()
}

function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const merged: TextRange[] = []
  for (const range of uniqueRanges(ranges)) {
    const previous = merged.at(-1)
    if (previous == null || range.start > previous.end) {
      merged.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

function uniqueRanges(ranges: readonly TextRange[]): TextRange[] {
  const unique = new Map<string, TextRange>()
  for (const range of ranges.toSorted(compareRanges)) {
    unique.set(`${range.start}:${range.end}`, range)
  }
  return [...unique.values()]
}

function overlaps(left: TextRange, right: TextRange): boolean {
  return left.start < right.end && right.start < left.end
}

function compareTokenRanges(left: LogicalToken, right: LogicalToken): number {
  return left.start - right.start || left.end - right.end
}

function compareRanges(left: TextRange, right: TextRange): number {
  return left.start - right.start || left.end - right.end
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Portable highlight ${name} must be a positive safe integer`)
  }
}
