/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DATABASE, ERR_VALIDATION } from '../lib/errors.js'
import type { DocumentRevisionValidationDetails } from '../@types/document-revision.js'

export function isDocumentRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Validate caller input without coercing strings, nulls, or missing values. */
export function parseDocumentRevision(value: unknown): number {
  if (isDocumentRevision(value)) return value
  const details: DocumentRevisionValidationDetails = {
    reason: value === undefined ? 'missing_document_revision' : 'invalid_document_revision',
  }
  throw ERR_VALIDATION({
    message: 'an observed positive safe-integer document revision is required',
    details,
  })
}

/** Convert driver BIGINT values without accepting unsafe or noncanonical values. */
export function documentRevisionFromDatabase(value: unknown): number {
  if (isDocumentRevision(value)) return value
  if (typeof value === 'bigint' && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value)
  }
  if (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)) {
    const revision = Number(value)
    if (isDocumentRevision(revision) && String(revision) === value) return revision
  }
  throw ERR_DATABASE({ message: 'database returned an invalid document revision' })
}
