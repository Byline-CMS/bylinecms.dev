/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { MAX_SEARCH_QUERY_LENGTH, type SearchMatching } from '@byline/core'

import { extractIdentifierSpans, maskIdentifierSpans } from './identifiers.js'
import { canonicalSegmenterLocale, resolveSearchLocale } from './locale.js'
import { normalizeForSearch, type SearchNormalization } from './normalize.js'
import type {
  AnalyzedText,
  AnalyzeQueryInput,
  AnalyzeTextInput,
  LogicalToken,
  PortableQueryPlan,
  PortableSearchAnalyzer,
  PortableSearchAnalyzerOptions,
  QueryConcept,
  QueryPhrase,
  ResolvedSearchMatching,
  SearchTokenExpander,
} from './types.js'

const PIPELINE_VERSION = 'portable1'
const NORMALIZATION_VERSION = 'nfkc-lower1'
const LOCALE_VERSION = 'locale1'
const IDENTIFIER_VERSION = 'identifiers2'
const GRAM_VERSION = 'han-bigram1'

const wordSegmenters = new Map<string, Intl.Segmenter>()

function wordSegmenter(locale: string): Intl.Segmenter {
  let segmenter = wordSegmenters.get(locale)
  if (segmenter == null) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
    wordSegmenters.set(locale, segmenter)
  }
  return segmenter
}

export function createPortableSearchAnalyzer(
  options: PortableSearchAnalyzerOptions = {}
): PortableSearchAnalyzer {
  return new PortableSearchAnalyzerImpl(options)
}

class PortableSearchAnalyzerImpl implements PortableSearchAnalyzer {
  readonly fingerprint: string

  private readonly defaultLocale: string
  private readonly hanLocale: 'zh' | 'ja'
  private readonly hanBigrams: boolean
  private readonly expanders: readonly SearchTokenExpander[]

  constructor(options: PortableSearchAnalyzerOptions) {
    this.defaultLocale = canonicalSegmenterLocale(options.defaultLocale) ?? 'en'
    this.hanLocale = options.hanLocale ?? 'zh'
    this.hanBigrams = options.hanBigrams ?? true
    this.expanders = options.expanders ?? []
    this.fingerprint = [
      PIPELINE_VERSION,
      NORMALIZATION_VERSION,
      `icu${process.versions.icu ?? 'unknown'}`,
      LOCALE_VERSION,
      `default-${this.defaultLocale}`,
      `han-${this.hanLocale}`,
      IDENTIFIER_VERSION,
      this.hanBigrams ? GRAM_VERSION : 'han-bigram0',
      ...this.expanders.map(
        (expander, index) => `expander${index}-${encodeURIComponent(expander.fingerprint)}`
      ),
    ].join('+')
  }

  analyzeText(input: AnalyzeTextInput): AnalyzedText {
    const normalization = normalizeForSearch(input.text)
    const locale = resolveSearchLocale(
      normalization.value,
      input.locale,
      this.defaultLocale,
      this.hanLocale
    )
    const identifiers = extractIdentifierSpans(normalization.value)
    const masked = maskIdentifierSpans(normalization.value, identifiers)

    const sourceTokens: LogicalToken[] = []
    for (const segment of wordSegmenter(locale).segment(masked)) {
      if (!segment.isWordLike || segment.segment.length === 0) continue
      sourceTokens.push(
        logicalToken(
          'exact',
          segment.segment,
          segment.index,
          segment.index + segment.segment.length,
          sourceTokens.length,
          locale,
          normalization
        )
      )
    }

    for (const identifier of identifiers) {
      const token = logicalToken(
        'identifier',
        identifier.value,
        identifier.start,
        identifier.end,
        0,
        locale,
        normalization
      )
      token.identifierKind = identifier.kind
      sourceTokens.push(token)
    }

    sourceTokens.sort(
      (a, b) => a.normalizedStart - b.normalizedStart || a.normalizedEnd - b.normalizedEnd
    )
    assignLogicalPositions(sourceTokens)

    const derivedTokens: LogicalToken[] = []
    for (const token of sourceTokens) {
      if (token.kind !== 'exact') continue
      for (const expander of this.expanders) {
        if (!expander.supports(locale)) continue
        for (const expansion of expander.expand(token)) {
          if (expansion.value.length === 0 || expansion.value === token.value) continue
          derivedTokens.push({ ...token, kind: expansion.kind, value: expansion.value })
        }
      }
    }

    const gramTokens = this.hanBigrams
      ? buildHanBigrams(masked, locale, normalization, sourceTokens)
      : []
    const exactTokens = sourceTokens.filter((token) => token.kind === 'exact')
    const identifierTokens = sourceTokens.filter((token) => token.kind === 'identifier')

    return {
      original: input.text,
      normalized: normalization.value,
      locale,
      tokens: [...sourceTokens, ...derivedTokens, ...gramTokens],
      exactTokens,
      derivedTokens,
      identifierTokens,
      gramTokens,
      analyzerFingerprint: this.fingerprint,
    }
  }

  analyzeQuery(input: AnalyzeQueryInput): PortableQueryPlan {
    if (input.query.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new RangeError(
        `Search query exceeds the maximum length of ${MAX_SEARCH_QUERY_LENGTH} UTF-16 code units`
      )
    }
    const matching = resolveMatching(input.matching)
    const full = this.analyzeText({ text: input.query, locale: input.locale })
    const parts = splitQueryParts(input.query)
    const concepts: QueryConcept[] = []
    const phrases: QueryPhrase[] = []
    const gramSequences: LogicalToken[][] = []

    for (const part of parts) {
      const analyzed = this.analyzeText({ text: part.text, locale: full.locale })
      const normalizedBase = normalizeForSearch(input.query.slice(0, part.start)).value.length
      const partConceptIndexes: number[] = []
      const sourceGroups = groupTokensByPosition([
        ...analyzed.exactTokens,
        ...analyzed.identifierTokens,
      ])

      for (const sourceGroup of sourceGroups) {
        const conceptIndex = concepts.length
        const queryToken = (token: LogicalToken): LogicalToken =>
          rebaseQueryToken(token, part.start, normalizedBase, conceptIndex)
        const identifiers = sourceGroup.filter((token) => token.kind === 'identifier')
        const exact = identifiers.length === 0 ? sourceGroup : []
        const source = identifiers[0] ?? exact[0]
        if (source == null) continue
        partConceptIndexes.push(conceptIndex)
        concepts.push({
          index: conceptIndex,
          position: conceptIndex,
          exactTokens: exact.map(queryToken),
          stemTokens:
            identifiers.length === 0
              ? analyzed.derivedTokens
                  .filter((token) => token.kind === 'stem' && token.position === source.position)
                  .map(queryToken)
              : [],
          lemmaTokens:
            identifiers.length === 0
              ? analyzed.derivedTokens
                  .filter((token) => token.kind === 'lemma' && token.position === source.position)
                  .map(queryToken)
              : [],
          normalizedTokens:
            identifiers.length === 0
              ? analyzed.derivedTokens
                  .filter(
                    (token) => token.kind === 'normalized' && token.position === source.position
                  )
                  .map(queryToken)
              : [],
          identifierTokens: identifiers.map(queryToken),
          gramTokens: analyzed.gramTokens
            .filter(
              (token) =>
                token.normalizedStart >= source.normalizedStart &&
                token.normalizedEnd <= source.normalizedEnd
            )
            .map(queryToken),
        })
      }

      if (analyzed.gramTokens.length > 0) {
        gramSequences.push(
          analyzed.gramTokens.map((token) =>
            rebaseQueryToken(token, part.start, normalizedBase, token.position)
          )
        )
      }
      if (matching.phrase !== 'off' && part.quoted && partConceptIndexes.length > 0) {
        phrases.push({ conceptIndexes: partConceptIndexes, explicit: true })
      }
    }

    if (matching.phrase === 'required' && concepts.length > 0) {
      phrases.length = 0
      phrases.push({
        conceptIndexes: concepts.map((concept) => concept.index),
        explicit: false,
      })
    }

    return {
      original: input.query,
      normalized: full.normalized,
      locale: full.locale,
      concepts,
      phrases,
      gramSequences,
      matching,
      analyzerFingerprint: this.fingerprint,
    }
  }
}

function assignLogicalPositions(tokens: LogicalToken[]): void {
  let position = -1
  let groupEnd = -1

  for (const token of tokens) {
    if (position === -1 || token.normalizedStart >= groupEnd) {
      position += 1
      groupEnd = token.normalizedEnd
    } else {
      groupEnd = Math.max(groupEnd, token.normalizedEnd)
    }
    token.position = position
  }
}

function groupTokensByPosition(tokens: readonly LogicalToken[]): LogicalToken[][] {
  const groups = new Map<number, LogicalToken[]>()
  for (const token of tokens.toSorted(
    (left, right) =>
      left.position - right.position ||
      left.normalizedStart - right.normalizedStart ||
      left.normalizedEnd - right.normalizedEnd
  )) {
    const group = groups.get(token.position)
    if (group == null) groups.set(token.position, [token])
    else group.push(token)
  }
  return [...groups.values()]
}

function logicalToken(
  kind: LogicalToken['kind'],
  value: string,
  normalizedStart: number,
  normalizedEnd: number,
  position: number,
  locale: string,
  normalization: SearchNormalization
): LogicalToken {
  const original = normalization.originalRange(normalizedStart, normalizedEnd)
  return {
    kind,
    value,
    normalizedStart,
    normalizedEnd,
    start: original.start,
    end: original.end,
    position,
    locale,
  }
}

function buildHanBigrams(
  text: string,
  locale: string,
  normalization: SearchNormalization,
  sourceTokens: readonly LogicalToken[]
): LogicalToken[] {
  const grams: LogicalToken[] = []
  let sourceIndex = 0
  let previousPosition = 0

  for (const match of text.matchAll(/\p{Script=Han}+/gu)) {
    const run = match[0]
    const runStart = match.index
    if (run == null || runStart == null) continue
    const characters: Array<{ value: string; start: number; end: number }> = []
    let offset = 0
    for (const value of run) {
      const start = runStart + offset
      offset += value.length
      characters.push({ value, start, end: runStart + offset })
    }
    for (let index = 0; index + 1 < characters.length; index++) {
      const first = characters[index]
      const second = characters[index + 1]
      if (first == null || second == null) continue
      while (sourceIndex < sourceTokens.length) {
        const source = sourceTokens[sourceIndex]
        if (source == null || source.normalizedEnd > first.start) break
        previousPosition = source.position
        sourceIndex += 1
      }
      const candidate = sourceTokens[sourceIndex]
      const position =
        candidate != null &&
        candidate.normalizedStart <= first.start &&
        candidate.normalizedEnd >= first.end
          ? candidate.position
          : previousPosition
      grams.push(
        logicalToken(
          'gram',
          first.value + second.value,
          first.start,
          second.end,
          position,
          locale,
          normalization
        )
      )
    }
  }
  return grams
}

export function resolveMatching(matching: SearchMatching | undefined): ResolvedSearchMatching {
  const operator = matching?.operator ?? 'all'
  const phrase = matching?.phrase ?? 'auto'
  const minimumShouldMatch = matching?.minimumShouldMatch

  if (
    minimumShouldMatch != null &&
    (!Number.isSafeInteger(minimumShouldMatch) || minimumShouldMatch < 1)
  ) {
    throw new RangeError('minimumShouldMatch must be a positive safe integer')
  }
  if (operator === 'all' && minimumShouldMatch != null) {
    throw new TypeError("minimumShouldMatch is only valid with operator: 'any'")
  }

  return {
    operator,
    phrase,
    ...(minimumShouldMatch != null ? { minimumShouldMatch } : {}),
  }
}

interface QueryPart {
  text: string
  start: number
  quoted: boolean
}

/** Split balanced ASCII-quoted spans while treating unmatched quotes as text. */
function splitQueryParts(query: string): QueryPart[] {
  const parts: QueryPart[] = []
  let cursor = 0

  while (cursor < query.length) {
    const open = query.indexOf('"', cursor)
    if (open < 0) {
      pushPart(parts, query.slice(cursor), cursor, false)
      break
    }
    const close = query.indexOf('"', open + 1)
    if (close < 0) {
      pushPart(parts, query.slice(cursor).replaceAll('"', ' '), cursor, false)
      break
    }
    pushPart(parts, query.slice(cursor, open), cursor, false)
    pushPart(parts, query.slice(open + 1, close), open + 1, true)
    cursor = close + 1
  }

  return parts
}

function pushPart(parts: QueryPart[], text: string, start: number, quoted: boolean): void {
  if (text.trim().length > 0) parts.push({ text, start, quoted })
}

function rebaseQueryToken(
  token: LogicalToken,
  originalBase: number,
  normalizedBase: number,
  position: number
): LogicalToken {
  return {
    ...token,
    normalizedStart: token.normalizedStart + normalizedBase,
    normalizedEnd: token.normalizedEnd + normalizedBase,
    start: token.start + originalBase,
    end: token.end + originalBase,
    position,
  }
}
