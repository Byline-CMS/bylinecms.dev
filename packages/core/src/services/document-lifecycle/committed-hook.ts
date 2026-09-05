/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  DOCUMENT_HOOK_COMMITTED_MARKER,
  ERR_DOCUMENT_HOOK_COMMITTED,
  ErrorCodes,
} from '../../lib/errors.js'
import type { DocumentLifecycleContext } from './context.js'

export type DocumentHookCommittedPhase =
  | 'afterCreate'
  | 'afterUpdate'
  | 'afterSave'
  | 'afterSystemFieldsChange'
  | 'afterStatusChange'
  | 'afterUnpublish'

export type DocumentHookSideEffectCode = typeof ErrorCodes.STORAGE | typeof ErrorCodes.UNHANDLED

export interface DocumentHookCommittedDetails {
  phase: DocumentHookCommittedPhase
  documentId: string
  documentVersionId: string
  revision: number
  sideEffectCode: DocumentHookSideEffectCode
}

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

function sideEffectCode(error: unknown): DocumentHookSideEffectCode {
  return readStringProperty(error, 'code') === ErrorCodes.STORAGE
    ? ErrorCodes.STORAGE
    : ErrorCodes.UNHANDLED
}

/** Read and validate the public, non-sensitive metadata from a committed hook failure. */
export function getDocumentHookCommittedDetails(
  error: unknown
): DocumentHookCommittedDetails | null {
  if (readStringProperty(error, 'code') !== ErrorCodes.DOCUMENT_HOOK_COMMITTED) return null

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
  const failureCode = readStringProperty(details, 'sideEffectCode')

  if (
    phase !== 'afterCreate' &&
    phase !== 'afterUpdate' &&
    phase !== 'afterSave' &&
    phase !== 'afterSystemFieldsChange' &&
    phase !== 'afterStatusChange' &&
    phase !== 'afterUnpublish'
  )
    return null
  if (
    !documentId ||
    (phase !== 'afterSystemFieldsChange' && !documentVersionId) ||
    documentVersionId === undefined
  )
    return null
  let revision: unknown
  try {
    revision = Reflect.get(details, 'revision')
  } catch {
    return null
  }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null
  if (failureCode !== ErrorCodes.STORAGE && failureCode !== ErrorCodes.UNHANDLED) return null

  return {
    phase,
    documentId,
    documentVersionId,
    sideEffectCode: failureCode,
    revision,
  }
}

/**
 * Run a hook after its document version has committed, preserving rejection
 * semantics while making the committed state machine-readable to hosts.
 */
export async function runCommittedDocumentHook(
  ctx: DocumentLifecycleContext,
  details: Omit<DocumentHookCommittedDetails, 'sideEffectCode'>,
  callback: () => Promise<void>
): Promise<void> {
  try {
    await callback()
  } catch (cause) {
    const committedError = ERR_DOCUMENT_HOOK_COMMITTED({
      message: `${DOCUMENT_HOOK_COMMITTED_MARKER} document write committed but ${details.phase} failed`,
      cause,
      captureStack: true,
      details: { ...details, sideEffectCode: sideEffectCode(cause) },
    })
    try {
      committedError.log(ctx.logger)
    } catch {
      // Diagnostic logging cannot erase the machine-readable committed result.
    }
    throw committedError
  }
}
