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
const MAX_TSVECTOR_POSITION = 16_383

export interface PortableIndexVector {
  /** PostgreSQL text representation accepted by `$n::tsvector`. */
  value: string
  analyzerFingerprint: string
}

/**
 * Build a weighted tsvector literal from portable logical terms. Expansions
 * share their source position, derived variants lose one weight class, and
 * Han grams always use the lowest class.
 */
export function buildPortableIndexVector(
  row: Pick<IndexRow, 'locale' | 'weighted'>,
  analyzer: PortableSearchAnalyzer
): PortableIndexVector {
  const lexemes = new Map<string, LexemePositions>()
  let positionBase = 0

  for (const weight of WEIGHT_CLASSES) {
    const analyzed = analyzer.analyzeText({ text: row.weighted[weight], locale: row.locale })
    const sourcePositionCount =
      Math.max(
        -1,
        ...analyzed.exactTokens.map(positionOf),
        ...analyzed.identifierTokens.map(positionOf)
      ) + 1
    const gramPositions = positionGrams(analyzed.gramTokens, positionBase + sourcePositionCount + 1)

    for (const token of analyzed.tokens) {
      const physical = encodeSqlToken(token)
      const position = gramPositions.get(token) ?? positionBase + token.position + 1
      const effectiveWeight = tokenWeight(token, weight)
      addLexeme(lexemes, physical, position, effectiveWeight)
    }

    // Keep a one-position boundary between weight buckets so phrases cannot
    // bridge independently configured fields solely because they were joined.
    positionBase = Math.max(positionBase + sourcePositionCount, ...gramPositions.values()) + 1
  }

  return {
    value: renderTsvector(lexemes),
    analyzerFingerprint: analyzer.fingerprint,
  }
}

interface LexemePositions {
  positions: Map<number, WeightClass>
  beyondPositionLimit: boolean
}

function positionOf(token: LogicalToken): number {
  return token.position
}

function positionGrams(
  grams: readonly LogicalToken[],
  firstPosition: number
): ReadonlyMap<LogicalToken, number> {
  const positioned = new Map<LogicalToken, number>()
  const ordered = grams.toSorted(
    (left, right) =>
      left.normalizedStart - right.normalizedStart || left.normalizedEnd - right.normalizedEnd
  )
  let position = firstPosition
  let previous: LogicalToken | undefined

  for (const gram of ordered) {
    // Overlapping bigrams in one Han run occupy consecutive positions.
    // Leave a gap between distinct runs so a phrase cannot bridge intervening
    // non-Han content.
    if (previous != null && gram.normalizedStart >= previous.normalizedEnd) position += 1
    positioned.set(gram, position)
    position += 1
    previous = gram
  }

  return positioned
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

function addLexeme(
  lexemes: Map<string, LexemePositions>,
  lexeme: string,
  position: number,
  weight: WeightClass
): void {
  let entry = lexemes.get(lexeme)
  if (entry == null) {
    entry = { positions: new Map(), beyondPositionLimit: false }
    lexemes.set(lexeme, entry)
  }

  if (position > MAX_TSVECTOR_POSITION) {
    entry.beyondPositionLimit = true
    return
  }

  const current = entry.positions.get(position)
  if (current == null || weightRank(weight) > weightRank(current)) {
    entry.positions.set(position, weight)
  }
}

function weightRank(weight: WeightClass): number {
  return WEIGHT_CLASSES.length - WEIGHT_CLASSES.indexOf(weight)
}

function renderTsvector(lexemes: ReadonlyMap<string, LexemePositions>): string {
  return [...lexemes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([lexeme, entry]) => {
      const positions = [...entry.positions.entries()]
        .sort(([left], [right]) => left - right)
        .map(([position, weight]) => `${position}${weight}`)

      // A bare lexeme still participates in matching when all of its
      // occurrences exceed PostgreSQL's positional ceiling.
      if (positions.length === 0 && entry.beyondPositionLimit) return `'${lexeme}'`
      return positions.length > 0 ? `'${lexeme}':${positions.join(',')}` : `'${lexeme}'`
    })
    .join(' ')
}
