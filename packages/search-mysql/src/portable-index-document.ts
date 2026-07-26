/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  encodeSqlToken,
  type LogicalToken,
  type PortableSearchAnalyzer,
} from '@byline/search-analysis'

import type { IndexRow, WeightClass } from './build-index-row.js'

const WEIGHT_CLASSES: readonly WeightClass[] = ['A', 'B', 'C', 'D']
const STREAM_BOUNDARY = 'bylinefulltextboundary'

export interface PortableMySqlIndexDocument {
  searchText: string
  weighted: Record<WeightClass, string>
  analyzerFingerprint: string
}

/**
 * Encode portable logical terms into text streams consumed by MySQL FULLTEXT.
 * Separate exact, expansion-kind, and Han-gram streams preserve adjacency for
 * phrase matching without letting phrases cross weight classes or token
 * streams.
 */
export function buildPortableMySqlIndexDocument(
  row: Pick<IndexRow, 'locale' | 'weighted'>,
  analyzer: PortableSearchAnalyzer
): PortableMySqlIndexDocument {
  const matchingStreams: string[] = []
  const tokensByWeight: Record<WeightClass, LogicalToken[]> = {
    A: [],
    B: [],
    C: [],
    D: [],
  }

  for (const sourceWeight of WEIGHT_CLASSES) {
    const analyzed = analyzer.analyzeText({
      text: row.weighted[sourceWeight],
      locale: row.locale,
    })
    matchingStreams.push(...serializeMatchingStreams(analyzed.tokens))
    for (const token of analyzed.tokens) {
      tokensByWeight[tokenWeight(token, sourceWeight)].push(token)
    }
  }

  const weighted: Record<WeightClass, string> = {
    A: serializeStreams(tokensByWeight.A),
    B: serializeStreams(tokensByWeight.B),
    C: serializeStreams(tokensByWeight.C),
    D: serializeStreams(tokensByWeight.D),
  }

  return {
    searchText: matchingStreams.join(` ${STREAM_BOUNDARY} `),
    weighted,
    analyzerFingerprint: analyzer.fingerprint,
  }
}

function tokenWeight(token: LogicalToken, sourceWeight: WeightClass): WeightClass {
  if (token.kind === 'gram') return 'D'
  if (token.kind === 'exact' || token.kind === 'identifier') return sourceWeight
  return lowerWeight(sourceWeight)
}

function lowerWeight(weight: WeightClass): WeightClass {
  switch (weight) {
    case 'A':
      return 'B'
    case 'B':
      return 'C'
    case 'C':
    case 'D':
      return 'D'
  }
}

function serializeStreams(tokens: readonly LogicalToken[]): string {
  const streams: LogicalToken[][] = []
  const source = tokens
    .filter((token) => token.kind === 'exact' || token.kind === 'identifier')
    .toSorted(compareTokens)
  if (source.length > 0) streams.push(source)

  for (const kind of ['stem', 'lemma', 'normalized'] as const) {
    const derived = tokens.filter((token) => token.kind === kind).toSorted(compareTokens)
    if (derived.length > 0) streams.push(derived)
  }

  const grams = tokens.filter((token) => token.kind === 'gram').toSorted(compareTokens)
  if (grams.length > 0) streams.push(grams)

  return streams
    .map((stream) => stream.map((token) => encodeSqlToken(token)).join(' '))
    .join(` ${STREAM_BOUNDARY} `)
}

/**
 * Preserve source-token adjacency for matching while making each expansion
 * kind phrase-capable. A derived stream falls back to the exact/identifier
 * token at positions where that kind produced no alternative, so a query such
 * as `"runs restoration"` can match indexed `"running restoration"` through
 * the stem `run` without losing the unchanged neighboring term.
 */
function serializeMatchingStreams(tokens: readonly LogicalToken[]): string[] {
  const source = tokens
    .filter((token) => token.kind === 'exact' || token.kind === 'identifier')
    .toSorted(compareTokens)
  const streams = source.length > 0 ? [serializeTokenStream(source)] : []

  for (const kind of ['stem', 'lemma', 'normalized'] as const) {
    const derived = tokens.filter((token) => token.kind === kind)
    if (derived.length === 0) continue

    const firstByPosition = new Map<number, LogicalToken>()
    for (const token of derived.toSorted(compareTokens)) {
      if (!firstByPosition.has(token.position)) firstByPosition.set(token.position, token)
    }
    streams.push(
      serializeTokenStream(source.map((token) => firstByPosition.get(token.position) ?? token))
    )
  }

  const grams = tokens.filter((token) => token.kind === 'gram').toSorted(compareTokens)
  if (grams.length > 0) streams.push(serializeTokenStream(grams))
  return streams.filter((stream) => stream.length > 0)
}

function serializeTokenStream(tokens: readonly LogicalToken[]): string {
  return tokens.map((token) => encodeSqlToken(token)).join(' ')
}

function compareTokens(left: LogicalToken, right: LogicalToken): number {
  return (
    left.position - right.position ||
    left.normalizedStart - right.normalizedStart ||
    left.normalizedEnd - right.normalizedEnd ||
    left.value.localeCompare(right.value)
  )
}
