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
  type PortableQueryPlan,
  type QueryConcept,
} from '@byline/search-analysis'

const MAX_PHRASE_VARIANTS = 256

export interface PortableMySqlQuery {
  /** Boolean-mode query per source concept; terms inside one query are ORs. */
  conceptQueries: string[]
  /** Alternative quoted Boolean-mode queries for each required phrase. */
  phraseQueries: string[][]
  /** Ordered Han-gram fallback phrases. */
  gramQueries: string[]
  /** Flat optional-term query used only for weighted relevance scoring. */
  rankingQuery: string
  operator: 'all' | 'any'
  minimumShouldMatch?: number
}

/** Translate a portable plan into parser-safe MySQL Boolean-mode inputs. */
export function buildPortableMySqlQuery(plan: PortableQueryPlan): PortableMySqlQuery {
  const conceptTerms = plan.concepts.map(conceptAlternatives)
  if (conceptTerms.some((terms) => terms.length === 0)) {
    throw new TypeError('Portable query plan contains a concept with no searchable terms')
  }

  const phraseQueries = plan.phrases.map((phrase) => {
    const alternatives = phrase.conceptIndexes.map((index) => conceptTerms[index])
    if (alternatives.some((terms) => terms == null || terms.length === 0)) {
      throw new RangeError('Portable query phrase references an unknown concept')
    }
    return phraseVariants(alternatives as string[][])
  })

  const gramQueries = plan.gramSequences
    .map((sequence) => quotedPhrase(orderedTerms(sequence)))
    .filter((query) => query.length > 0)
  const rankingQuery = [
    ...conceptTerms.flat(),
    ...plan.gramSequences.flatMap((sequence) => orderedTerms(sequence)),
  ]
    .filter((term, index, terms) => terms.indexOf(term) === index)
    .join(' ')

  return {
    conceptQueries: conceptTerms.map((terms) => terms.join(' ')),
    phraseQueries,
    gramQueries,
    rankingQuery,
    operator: plan.matching.operator,
    ...(plan.matching.minimumShouldMatch != null
      ? { minimumShouldMatch: plan.matching.minimumShouldMatch }
      : {}),
  }
}

function conceptAlternatives(concept: QueryConcept): string[] {
  const terms = [
    ...concept.exactTokens,
    ...concept.stemTokens,
    ...concept.lemmaTokens,
    ...concept.normalizedTokens,
    ...concept.identifierTokens,
  ].map((token) => encodeSqlToken(token))

  const gramPhrase = quotedPhrase(orderedTerms(concept.gramTokens))
  if (gramPhrase.length > 0) terms.push(gramPhrase)
  return [...new Set(terms)]
}

function phraseVariants(alternatives: string[][]): string[] {
  let variants: string[][] = [[]]
  for (const terms of alternatives) {
    const next: string[][] = []
    for (const prefix of variants) {
      for (const term of terms) {
        // A concept-local gram fallback is itself quoted and cannot be nested
        // into a larger MySQL phrase. Cross-concept grams are represented by
        // `gramQueries` instead.
        if (term.startsWith('"')) continue
        next.push([...prefix, term])
        if (next.length >= MAX_PHRASE_VARIANTS) break
      }
      if (next.length >= MAX_PHRASE_VARIANTS) break
    }
    variants = next
  }
  return variants.map(quotedPhrase).filter((query) => query.length > 0)
}

function orderedTerms(tokens: readonly LogicalToken[]): string[] {
  return tokens
    .toSorted(
      (left, right) =>
        left.normalizedStart - right.normalizedStart || left.normalizedEnd - right.normalizedEnd
    )
    .map((token) => encodeSqlToken(token))
}

function quotedPhrase(terms: readonly string[]): string {
  return terms.length > 0 ? `"${terms.join(' ')}"` : ''
}
