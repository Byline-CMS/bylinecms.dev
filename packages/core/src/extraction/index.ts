/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Browser-safe, provisional extraction contract helpers. The contract types live in
// `@types/extraction-types.ts`. The verified source read is server-only and lives in
// `@byline/core/stored-files`.

export {
  type ExtractionArtifactIssue,
  type ExtractionArtifactIssueCode,
  validateExtractionArtifact,
} from './artifact.js'
export {
  ExtractionProviderError,
  isExtractionProviderError,
  isFileExtractionFailure,
} from './errors.js'
export { isSourceVerificationEvidence } from './evidence.js'
export { exclusionState } from './outcomes.js'
export { type PageMapIssue, type PageMapIssueCode, validatePageMap } from './page-map.js'
export {
  buildExtractionProducer,
  type ExtractionProducerIdentity,
  producerConfigHash,
} from './producer.js'
export { decideExtractionWork, type ExistingExtraction } from './work.js'
