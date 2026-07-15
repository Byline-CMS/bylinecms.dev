/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  DeleteDocumentResult,
  DeleteDocumentSideEffectCode,
  DeleteDocumentSideEffectPhase,
} from '@byline/core'
import { ErrorCodes } from '@byline/core'

export type DeleteDocumentPublicSideEffectPhase = DeleteDocumentSideEffectPhase | 'unknown'
export type DeleteDocumentPublicSideEffectCode = DeleteDocumentSideEffectCode

export interface DeleteDocumentPublicSideEffectFailure {
  phase: DeleteDocumentPublicSideEffectPhase
  code: DeleteDocumentPublicSideEffectCode
}

export type DeleteDocumentResponse =
  | {
      status: 'ok'
      deletedVersionCount: number
      outcome: 'committed'
      sideEffectFailures: []
    }
  | {
      status: 'ok'
      deletedVersionCount: number
      outcome: 'committed-with-side-effect-failures'
      sideEffectFailures: [
        DeleteDocumentPublicSideEffectFailure,
        ...DeleteDocumentPublicSideEffectFailure[],
      ]
    }

function sanitizePhase(phase: DeleteDocumentSideEffectPhase): DeleteDocumentPublicSideEffectPhase {
  if (phase === 'storageCleanup' || phase === 'afterTreeChange' || phase === 'afterDelete') {
    return phase
  }
  return 'unknown'
}

function sanitizeCode(code: string): DeleteDocumentPublicSideEffectCode {
  return code === ErrorCodes.STORAGE ? ErrorCodes.STORAGE : ErrorCodes.UNHANDLED
}

function sanitizeFailure({
  phase,
  code,
}: {
  phase: DeleteDocumentSideEffectPhase
  code: string
}): DeleteDocumentPublicSideEffectFailure {
  return { phase: sanitizePhase(phase), code: sanitizeCode(code) }
}

export function toDeleteDocumentResponse(result: DeleteDocumentResult): DeleteDocumentResponse {
  if (result.outcome === 'committed') {
    return { status: 'ok', ...result }
  }

  const [firstFailure, ...remainingFailures] = result.sideEffectFailures
  return {
    status: 'ok',
    deletedVersionCount: result.deletedVersionCount,
    outcome: result.outcome,
    sideEffectFailures: [sanitizeFailure(firstFailure), ...remainingFailures.map(sanitizeFailure)],
  }
}

export function hasDeleteSideEffectFailures(
  result: Pick<DeleteDocumentResult, 'outcome'>
): boolean {
  return result.outcome === 'committed-with-side-effect-failures'
}
