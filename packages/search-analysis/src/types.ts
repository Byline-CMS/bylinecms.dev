/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchMatching, SearchPhraseMode, SearchTermOperator } from '@byline/core'

/** Portable logical token classes. Physical backend representations are separate. */
export type LogicalTokenKind = 'exact' | 'stem' | 'lemma' | 'normalized' | 'identifier' | 'gram'

/** Domain category attached to an identifier token for diagnostics and tuning. */
export type SearchIdentifierKind =
  | 'url'
  | 'email'
  | 'mention'
  | 'hashtag'
  | 'sku'
  | 'version'
  | 'technical'

/**
 * One logical term produced by portable analysis. All offsets use UTF-16
 * string indexes, matching `Intl.Segmenter` and JavaScript `slice`.
 */
export interface LogicalToken {
  kind: LogicalTokenKind
  value: string
  /** Offset into normalized search text. */
  normalizedStart: number
  /** Exclusive offset into normalized search text. */
  normalizedEnd: number
  /** Offset into the original, unmodified input. */
  start: number
  /** Exclusive offset into the original, unmodified input. */
  end: number
  /** Source-order position; expansions retain their source token's position. */
  position: number
  locale: string
  identifierKind?: SearchIdentifierKind
}

/** Result of analyzing one original text value. */
export interface AnalyzedText {
  original: string
  normalized: string
  locale: string
  tokens: LogicalToken[]
  exactTokens: LogicalToken[]
  derivedTokens: LogicalToken[]
  identifierTokens: LogicalToken[]
  gramTokens: LogicalToken[]
  analyzerFingerprint: string
}

/** A variant emitted by an optional language-specific token expander. */
export interface SearchTokenExpansion {
  kind: 'stem' | 'lemma' | 'normalized'
  value: string
}

/**
 * Plug-in point for stemming, lemmatization, or language-specific normalized
 * variants. Expansion augments exact terms; it never replaces them.
 */
export interface SearchTokenExpander {
  /** Stable family/version component included in the analyzer fingerprint. */
  readonly fingerprint: string
  supports(locale: string): boolean
  expand(token: LogicalToken): readonly SearchTokenExpansion[]
}

/** One user concept with its recall alternatives kept together. */
export interface QueryConcept {
  index: number
  position: number
  exactTokens: LogicalToken[]
  stemTokens: LogicalToken[]
  lemmaTokens: LogicalToken[]
  normalizedTokens: LogicalToken[]
  identifierTokens: LogicalToken[]
  /**
   * Ordered grams that can act as low-weight fallback for this concept.
   * They are a sequence, not independent OR alternatives.
   */
  gramTokens: LogicalToken[]
}

/** Ordered concept indexes that form a phrase constraint or boost. */
export interface QueryPhrase {
  conceptIndexes: number[]
  explicit: boolean
}

/** Resolved matching policy with analyzer defaults applied. */
export interface ResolvedSearchMatching {
  operator: SearchTermOperator
  phrase: SearchPhraseMode
  minimumShouldMatch?: number
}

/**
 * Backend-neutral lexical query plan. Adapters translate concept alternatives,
 * phrase order, and gram fallback into native query syntax.
 */
export interface PortableQueryPlan {
  original: string
  normalized: string
  locale: string
  concepts: QueryConcept[]
  phrases: QueryPhrase[]
  /** Ordered fallback grams, including grams that cross word boundaries. */
  gramSequences: LogicalToken[][]
  matching: ResolvedSearchMatching
  analyzerFingerprint: string
}

export interface AnalyzeTextInput {
  text: string
  /** Declared field/document locale. Invalid or unsupported values fall back safely. */
  locale?: string
}

export interface AnalyzeQueryInput {
  query: string
  locale?: string
  matching?: SearchMatching
}

export interface PortableSearchAnalyzer {
  readonly fingerprint: string
  analyzeText(input: AnalyzeTextInput): AnalyzedText
  analyzeQuery(input: AnalyzeQueryInput): PortableQueryPlan
}

export interface PortableSearchAnalyzerOptions {
  /** Fallback after declared locale and script detection. Defaults to `en`. */
  defaultLocale?: string
  /** Locale chosen for otherwise ambiguous Han-only text. Defaults to `zh`. */
  hanLocale?: 'zh' | 'ja'
  /** Emit overlapping Han bigrams. Defaults to true. */
  hanBigrams?: boolean
  /** Optional exact-preserving language expansion stages. */
  expanders?: readonly SearchTokenExpander[]
}
