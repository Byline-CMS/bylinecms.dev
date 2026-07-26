/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export { createPortableSearchAnalyzer, resolveMatching } from './analyzer.js'
export {
  canonicalSegmenterLocale,
  detectSearchLocale,
  resolveSearchLocale,
} from './locale.js'
export { normalizeForSearch, type SearchNormalization } from './normalize.js'
export {
  encodeSqlToken,
  encodeSqlTokens,
  type SqlTokenCodecOptions,
} from './sql-token-codec.js'
export type {
  AnalyzedText,
  AnalyzeQueryInput,
  AnalyzeTextInput,
  LogicalToken,
  LogicalTokenKind,
  PortableQueryPlan,
  PortableSearchAnalyzer,
  PortableSearchAnalyzerOptions,
  QueryConcept,
  QueryPhrase,
  ResolvedSearchMatching,
  SearchIdentifierKind,
  SearchTokenExpander,
  SearchTokenExpansion,
} from './types.js'
