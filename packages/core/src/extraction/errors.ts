/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ExtractionFailureScope } from '../@types/extraction-types.js'

const ERROR_CODE = 'ERR_EXTRACTION_PROVIDER'

/**
 * A typed provider failure.
 *
 * - `file`: the input caused it (corrupt, encrypted, unsupported format).
 *   Orchestration may record a per-file failure for this source and producer.
 * - `infrastructure`: the service failed (timeout, unavailable, bad credentials).
 *   Orchestration must not record the file as bad and must preserve existing
 *   artifacts.
 *
 * `retryable` is independent policy: bad credentials are `infrastructure` but not
 * usefully retryable until repaired.
 *
 * @provisional
 */
export class ExtractionProviderError extends Error {
  readonly code = ERROR_CODE
  readonly failureScope: ExtractionFailureScope
  readonly retryable: boolean

  constructor(
    message: string,
    options: { failureScope: ExtractionFailureScope; retryable: boolean; cause?: unknown }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ExtractionProviderError'
    this.failureScope = options.failureScope
    this.retryable = options.retryable
  }
}

/**
 * Whether a value is a typed provider failure. It checks the `code` brand rather
 * than `instanceof`, so an error thrown by a second copy of `@byline/core` still
 * classifies.
 *
 * @provisional
 */
export function isExtractionProviderError(error: unknown): error is ExtractionProviderError {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as Partial<ExtractionProviderError>
  return (
    candidate.code === ERROR_CODE &&
    (candidate.failureScope === 'file' || candidate.failureScope === 'infrastructure') &&
    typeof candidate.retryable === 'boolean'
  )
}

/**
 * Whether a value is a typed `file` failure. An untyped error or an abort is never
 * evidence that the file is bad.
 *
 * @provisional
 */
export function isFileExtractionFailure(error: unknown): error is ExtractionProviderError {
  return isExtractionProviderError(error) && error.failureScope === 'file'
}
