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

export interface PortablePostgresQuery {
  /** Complete matching/ranking tsquery source for `to_tsquery('simple', …)`. */
  tsquery: string
  /** One query per source concept, used to enforce minimum-should-match. */
  conceptTsqueries: string[]
  minimumShouldMatch?: number
}

/** Translate a backend-neutral plan into parser-safe PostgreSQL tsquery text. */
export function buildPortablePostgresQuery(plan: PortableQueryPlan): PortablePostgresQuery {
  const conceptTsqueries = plan.concepts.map(conceptExpression)
  if (conceptTsqueries.some((expression) => expression.length === 0)) {
    throw new TypeError('Portable query plan contains a concept with no searchable terms')
  }
  if (conceptTsqueries.length === 0) {
    return { tsquery: '', conceptTsqueries: [] }
  }

  const operator = plan.matching.operator === 'all' ? '&' : '|'
  const groupedConcepts = groupCrossConceptGrams(plan, conceptTsqueries, operator)
  const clauses = [joinExpressions(groupedConcepts, operator)]

  for (const phrase of plan.phrases) {
    const expressions = phrase.conceptIndexes.map((index) => conceptTsqueries[index] ?? '')
    if (expressions.some((expression) => expression.length === 0)) {
      throw new RangeError('Portable query phrase references an unknown concept')
    }
    clauses.push(joinExpressions(expressions, '<->'))
  }

  return {
    tsquery: joinExpressions(clauses, '&'),
    conceptTsqueries,
    ...(plan.matching.minimumShouldMatch != null
      ? { minimumShouldMatch: plan.matching.minimumShouldMatch }
      : {}),
  }
}

function conceptExpression(concept: QueryConcept): string {
  const alternatives = uniqueTerms([
    ...concept.exactTokens,
    ...concept.stemTokens,
    ...concept.lemmaTokens,
    ...concept.normalizedTokens,
    ...concept.identifierTokens,
  ])

  const grams = orderedTerms(concept.gramTokens)
  if (grams.length > 0) alternatives.push(joinExpressions(grams, '<->'))

  return joinExpressions(alternatives, '|')
}

function groupCrossConceptGrams(
  plan: PortableQueryPlan,
  concepts: readonly string[],
  operator: '&' | '|'
): string[] {
  const replacements = new Map<number, { expression: string; through: number }>()

  for (const sequence of plan.gramSequences) {
    if (sequence.length === 0) continue
    const start = Math.min(...sequence.map((token) => token.normalizedStart))
    const end = Math.max(...sequence.map((token) => token.normalizedEnd))
    const indexes = plan.concepts
      .filter((concept) => conceptOverlaps(concept, start, end))
      .map((concept) => concept.index)

    if (indexes.length < 2) continue
    const first = indexes[0]
    const last = indexes.at(-1)
    if (first == null || last == null || last - first + 1 !== indexes.length) continue

    const original = joinExpressions(
      indexes.map((index) => concepts[index] ?? ''),
      operator
    )
    const gramPhrase = joinExpressions(orderedTerms(sequence), '<->')
    if (original.length === 0 || gramPhrase.length === 0) continue

    replacements.set(first, {
      expression: joinExpressions([original, gramPhrase], '|'),
      through: last,
    })
  }

  const grouped: string[] = []
  for (let index = 0; index < concepts.length; index++) {
    const replacement = replacements.get(index)
    if (replacement != null) {
      grouped.push(replacement.expression)
      index = replacement.through
      continue
    }
    if (
      [...replacements.entries()].some(([start, entry]) => index > start && index <= entry.through)
    ) {
      continue
    }
    const concept = concepts[index]
    if (concept != null) grouped.push(concept)
  }
  return grouped
}

function conceptOverlaps(concept: QueryConcept, start: number, end: number): boolean {
  const source = [...concept.exactTokens, ...concept.identifierTokens]
  return source.some((token) => token.normalizedStart < end && token.normalizedEnd > start)
}

function uniqueTerms(tokens: readonly LogicalToken[]): string[] {
  return [...new Set(tokens.map((token) => encodeSqlToken(token)))]
}

function orderedTerms(tokens: readonly LogicalToken[]): string[] {
  return tokens
    .toSorted(
      (left, right) =>
        left.normalizedStart - right.normalizedStart || left.normalizedEnd - right.normalizedEnd
    )
    .map((token) => encodeSqlToken(token))
}

function joinExpressions(expressions: readonly string[], operator: '&' | '|' | '<->'): string {
  const nonEmpty = expressions.filter((expression) => expression.length > 0)
  if (nonEmpty.length === 0) return ''
  if (nonEmpty.length === 1) return nonEmpty[0] ?? ''
  return `(${nonEmpty.map((expression) => `(${expression})`).join(` ${operator} `)})`
}
