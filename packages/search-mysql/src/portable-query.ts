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
    const concepts = phrase.conceptIndexes.map((index) => plan.concepts[index])
    if (concepts.some((concept) => concept == null)) {
      throw new RangeError('Portable query phrase references an unknown concept')
    }
    return phraseStreamVariants(concepts as QueryConcept[])
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

/**
 * Mirror the index's phrase-capable source and expansion-kind streams. Mixed
 * expansion kinds never coexist in one indexed stream, so their Cartesian
 * product would only produce impossible phrases.
 */
function phraseStreamVariants(concepts: readonly QueryConcept[]): string[] {
  const source = concepts.map(sourceToken)
  const variants: LogicalToken[][] = [source]

  for (const kind of ['stemTokens', 'lemmaTokens', 'normalizedTokens'] as const) {
    if (!concepts.some((concept) => concept[kind].length > 0)) continue
    variants.push(concepts.map((concept, index) => concept[kind][0] ?? source[index]!))
  }

  return [
    ...new Set(
      variants
        .map((tokens) => quotedPhrase(tokens.map((token) => encodeSqlToken(token))))
        .filter((query) => query.length > 0)
    ),
  ]
}

function sourceToken(concept: QueryConcept): LogicalToken {
  const token = concept.identifierTokens[0] ?? concept.exactTokens[0]
  if (token == null) throw new TypeError('Portable query concept has no source token')
  return token
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
