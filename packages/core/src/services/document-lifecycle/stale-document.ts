/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DOCUMENT_STALE, ErrorCodes } from '../../lib/errors.js'
import { isDocumentRevision } from '../../storage/document-revision.js'
import type {
  DocumentRevisionValidationDetails,
  DocumentStaleDetails,
} from '../../@types/document-revision.js'

function property(value: unknown, key: string): unknown {
  try {
    if (typeof value !== 'object' || value === null) return undefined
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Decode only allowlisted fields; works with live errors and serialized reports. */
export function getDocumentStaleDetails(error: unknown): DocumentStaleDetails | null {
  if (property(error, 'code') !== ErrorCodes.DOCUMENT_STALE) return null
  const details = property(error, 'details')
  const reason = property(details, 'reason')
  if (reason === 'singleton_slot_changed') {
    const singletonPath = property(details, 'singletonPath')
    if (
      !nonemptyString(singletonPath) ||
      property(details, 'expectedState') !== 'empty' ||
      property(details, 'currentState') !== 'document'
    ) {
      return null
    }
    return { reason, singletonPath, expectedState: 'empty', currentState: 'document' }
  }
  const documentId = property(details, 'documentId')
  if (!nonemptyString(documentId)) return null
  if (reason === 'revision_mismatch') {
    const expectedRevision = property(details, 'expectedRevision')
    const currentRevision = property(details, 'currentRevision')
    if (
      !isDocumentRevision(expectedRevision) ||
      !isDocumentRevision(currentRevision) ||
      expectedRevision === currentRevision
    ) {
      return null
    }
    return { reason, documentId, expectedRevision, currentRevision }
  }
  if (reason === 'version_parent_mismatch') {
    const previousVersionId = property(details, 'previousVersionId')
    const currentVersionId = property(details, 'currentVersionId')
    if (
      !nonemptyString(previousVersionId) ||
      (currentVersionId !== null && !nonemptyString(currentVersionId)) ||
      previousVersionId === currentVersionId
    ) {
      return null
    }
    return { reason, documentId, previousVersionId, currentVersionId }
  }
  return null
}

export function getDocumentRevisionValidationDetails(
  error: unknown
): DocumentRevisionValidationDetails | null {
  if (property(error, 'code') !== ErrorCodes.VALIDATION) return null
  const reason = property(property(error, 'details'), 'reason')
  if (reason !== 'missing_document_revision' && reason !== 'invalid_document_revision') {
    return null
  }
  return { reason }
}

/** Private lifecycle boundary adapter; never reclassify unrelated conflict errors. */
export function normalizeDocumentVersionParentError(error: unknown): unknown {
  if (property(error, 'code') !== ErrorCodes.CONFLICT) return error
  const details = property(error, 'details')
  if (property(details, 'reason') !== 'stale') return error
  const staleDetails = getDocumentStaleDetails({
    code: ErrorCodes.DOCUMENT_STALE,
    details: {
      reason: 'version_parent_mismatch',
      documentId: property(details, 'documentId'),
      previousVersionId: property(details, 'previousVersionId'),
      currentVersionId: property(details, 'currentVersionId'),
    },
  })
  if (staleDetails === null) return error
  return ERR_DOCUMENT_STALE({
    message: 'the document changed before the new version could be saved',
    details: staleDetails,
    cause: error,
  })
}
