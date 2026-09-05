import {
  BylineError,
  ErrorCodes,
  getDocumentRevisionValidationDetails,
  getDocumentStaleDetails,
  getLockConflictDetails,
} from '@byline/core'
import { getDocumentHookCommittedDetails } from '@byline/core/services'

import { committedTreeReceipt } from './structural-receipt.js'

/** Error subclasses lose custom properties in the server-function serializer.
 * Throw only validated plain data for document failures; never transport causes,
 * SQL, hook messages or an unverified current revision. */
export function documentMutationError(error: unknown): unknown {
  const stale = getDocumentStaleDetails(error)
  if (stale)
    return {
      code: ErrorCodes.DOCUMENT_STALE,
      message: 'This document has changed. Reload before making changes.',
      details: stale,
    }
  const validation = getDocumentRevisionValidationDetails(error)
  if (validation)
    return {
      code: ErrorCodes.VALIDATION,
      message: 'Reload this document before making changes.',
      details: validation,
    }
  const lock = getLockConflictDetails(error)
  if (lock)
    return {
      code: ErrorCodes.LOCK_CONFLICT,
      message:
        'This change could not be saved because another operation was using the document. Reload before trying again.',
      details: lock,
    }
  const tree = committedTreeReceipt(error)
  if (tree)
    return {
      code: ErrorCodes.TREE_HOOK_COMMITTED,
      message: 'The structure was saved, but a follow-up action failed.',
      details: tree,
    }
  const committed = getDocumentHookCommittedDetails(error)
  if (committed)
    return {
      code: ErrorCodes.DOCUMENT_HOOK_COMMITTED,
      message: 'The document was saved, but a follow-up action failed.',
      details: committed,
    }
  if (error instanceof BylineError && error.code === ErrorCodes.NOT_FOUND)
    return { code: ErrorCodes.NOT_FOUND, message: 'This document is no longer available.' }
  return error
}

export function withDocumentMutationErrors<T, R>(
  handler: (input: T) => Promise<R>
): (input: T) => Promise<R> {
  return async (input) => {
    try {
      return await handler(input)
    } catch (error) {
      throw documentMutationError(error)
    }
  }
}
