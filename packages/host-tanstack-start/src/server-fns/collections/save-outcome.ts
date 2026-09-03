/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type DocumentHookCommittedPhase,
  type DocumentHookSideEffectCode,
  getDocumentHookCommittedDetails,
} from '@byline/core/services'

export type { DocumentHookCommittedPhase, DocumentHookSideEffectCode }

export interface CollectionDocumentCommittedHookFailureResponse {
  status: 'committed-hook-failed'
  documentId: string
  documentVersionId: string
  sideEffectFailure: {
    phase: DocumentHookCommittedPhase
    code: DocumentHookSideEffectCode
  }
}

/**
 * Convert only validated core committed-hook errors into safe wire data. Raw
 * hook errors, messages, stack traces, and storage paths remain server-side.
 */
export function toCommittedDocumentHookFailureResponse(
  error: unknown
): CollectionDocumentCommittedHookFailureResponse | null {
  const details = getDocumentHookCommittedDetails(error)
  if (details == null) return null

  return {
    status: 'committed-hook-failed',
    documentId: details.documentId,
    documentVersionId: details.documentVersionId,
    sideEffectFailure: {
      phase: details.phase,
      code: details.sideEffectCode,
    },
  }
}

export function hasCommittedDocumentHookFailure(
  result: unknown
): result is CollectionDocumentCommittedHookFailureResponse {
  return (
    typeof result === 'object' &&
    result != null &&
    'status' in result &&
    result.status === 'committed-hook-failed'
  )
}
