/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export type DocumentHookCommittedPhase = 'afterCreate' | 'afterUpdate'
export type DocumentHookSideEffectCode = 'ERR_STORAGE' | 'ERR_UNHANDLED'

const DOCUMENT_HOOK_COMMITTED_CODE = 'ERR_DOCUMENT_HOOK_COMMITTED'

function readStringProperty(value: unknown, key: string): string | undefined {
  try {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
      return undefined
    }
    const property = Reflect.get(value, key)
    return typeof property === 'string' ? property : undefined
  } catch {
    return undefined
  }
}

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
  if (readStringProperty(error, 'code') !== DOCUMENT_HOOK_COMMITTED_CODE) return null

  let details: unknown
  try {
    details = Reflect.get(error as object, 'details')
  } catch {
    return null
  }
  if (typeof details !== 'object' || details === null) return null

  const phase = readStringProperty(details, 'phase')
  const documentId = readStringProperty(details, 'documentId')
  const documentVersionId = readStringProperty(details, 'documentVersionId')
  const sideEffectCode = readStringProperty(details, 'sideEffectCode')

  if (phase !== 'afterCreate' && phase !== 'afterUpdate') return null
  if (!documentId || !documentVersionId) return null
  if (sideEffectCode !== 'ERR_STORAGE' && sideEffectCode !== 'ERR_UNHANDLED') return null

  return {
    status: 'committed-hook-failed',
    documentId,
    documentVersionId,
    sideEffectFailure: {
      phase,
      code: sideEffectCode,
    },
  }
}

export function hasCommittedDocumentHookFailure(result: { status: string }): boolean {
  return result.status === 'committed-hook-failed'
}
