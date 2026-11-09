/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { CONTENT_HASH_PATTERN, STORAGE_VALIDATOR_LIMITS } from '../storage/content-hash.js'
import { isIsoDateTime, isPlainObject } from './internal.js'
import type { SourceVerificationEvidence } from '../@types/extraction-types.js'

const isBoundedString = (value: unknown, limit: number): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= limit

const FALLBACK_REASONS: readonly unknown[] = ['changed', 'unsupported-kind', 'unestablishable']
const READ_BASES: readonly unknown[] = ['expected', 'unconditional', 'fallback']

/**
 * Whether a stored record is valid verification evidence, optionally for a given
 * hash. Unknown extra members are ignored, so a later minor can add members without
 * invalidating stored evidence.
 *
 * Records written before `readBasis` existed stay valid, with or without a fallback
 * reason. The presence of a JSON key is not evidence, and a hash copied from the
 * saved file value does not make a record valid.
 *
 * @provisional
 */
export function isSourceVerificationEvidence(
  value: unknown,
  options?: { expectedHash?: string }
): value is SourceVerificationEvidence {
  if (!isPlainObject(value)) return false
  const {
    expectedHash,
    contentHash,
    validator,
    verifiedAt,
    size,
    readBasis,
    preconditionFallback,
  } = value

  if (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash)) return false
  if (expectedHash !== contentHash) return false
  if (options?.expectedHash !== undefined && expectedHash !== options.expectedHash) return false
  if (
    !isPlainObject(validator) ||
    !isBoundedString(validator.kind, STORAGE_VALIDATOR_LIMITS.kind) ||
    !isBoundedString(validator.value, STORAGE_VALIDATOR_LIMITS.value)
  ) {
    return false
  }
  if (!isIsoDateTime(verifiedAt)) return false
  if (size !== undefined && (!Number.isSafeInteger(size) || (size as number) < 0)) return false
  if (readBasis !== undefined && !READ_BASES.includes(readBasis)) return false
  if (preconditionFallback !== undefined && !FALLBACK_REASONS.includes(preconditionFallback)) {
    return false
  }

  // A legacy record has no readBasis, and any fallback reason is valid on it.
  if (readBasis === undefined) return true
  return readBasis === 'fallback'
    ? preconditionFallback !== undefined
    : preconditionFallback === undefined
}
