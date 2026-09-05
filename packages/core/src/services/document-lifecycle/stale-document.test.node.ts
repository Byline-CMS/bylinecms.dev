import { describe, expect, expectTypeOf, it } from 'vitest'

import { ERR_CONFLICT, ERR_DOCUMENT_STALE, ERR_VALIDATION, ErrorCodes } from '../../lib/errors.js'
import { assertDocumentVersionParent } from '../../storage/document-version-parent.js'
import {
  getDocumentRevisionValidationDetails,
  getDocumentStaleDetails,
  normalizeDocumentVersionParentError,
} from './stale-document.js'
import type {
  DocumentMutationResult,
  DocumentRevisionReceipt,
  DocumentStaleDetails,
  SingletonSavePrecondition,
} from '../../@types/document-revision.js'
import type { DocumentHookCommittedDetails } from './committed-hook.js'
import type { DeleteDocumentResult } from './delete.js'

const variants: DocumentStaleDetails[] = [
  { reason: 'revision_mismatch', documentId: 'doc', expectedRevision: 1, currentRevision: 2 },
  {
    reason: 'version_parent_mismatch',
    documentId: 'doc',
    previousVersionId: 'previous',
    currentVersionId: 'current',
  },
  {
    reason: 'version_parent_mismatch',
    documentId: 'doc',
    previousVersionId: 'previous',
    currentVersionId: null,
  },
  {
    reason: 'singleton_slot_changed',
    singletonPath: 'settings',
    expectedState: 'empty',
    currentState: 'document',
  },
]

describe('document stale error contract', () => {
  it.each(variants)(
    'decodes live and serialized $reason errors with allowlisted fields',
    (details) => {
      const error = ERR_DOCUMENT_STALE({
        message: 'stale',
        details,
        logExtra: { secret: 'private' },
      })
      expect(getDocumentStaleDetails(error)).toEqual(details)
      const report = JSON.parse(JSON.stringify(error.report()))
      report.details.secret = 'must not propagate'
      expect(getDocumentStaleDetails(report)).toEqual(details)
      expect(report).not.toHaveProperty('logExtra')
    }
  )

  it.each([
    null,
    undefined,
    {},
    new Error('stale_document'),
    { code: ErrorCodes.CONFLICT, details: variants[0] },
    { code: ErrorCodes.DOCUMENT_STALE },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[0], expectedRevision: '1' } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[0], currentRevision: 1 } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[0], currentRevision: Infinity } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[0], documentId: ' ' } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[1], currentVersionId: undefined } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[1], currentVersionId: 'previous' } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[3], expectedState: 'document' } },
    { code: ErrorCodes.DOCUMENT_STALE, details: { ...variants[3], singletonPath: '' } },
  ])('rejects unrelated or malformed payload %s', (value) => {
    expect(getDocumentStaleDetails(value)).toBeNull()
  })

  it('tolerates hostile properties without throwing', () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error('unreadable')
        },
      }
    )
    expect(getDocumentStaleDetails(hostile)).toBeNull()
    expect(
      getDocumentStaleDetails({ code: ErrorCodes.DOCUMENT_STALE, details: hostile })
    ).toBeNull()
    expect(getDocumentRevisionValidationDetails(hostile)).toBeNull()
    expect(normalizeDocumentVersionParentError(hostile)).toBe(hostile)
  })

  it.each(['missing_document_revision', 'invalid_document_revision'] as const)(
    'decodes typed validation reason %s only with the validation code',
    (reason) => {
      const error = ERR_VALIDATION({ message: 'invalid', details: { reason, secret: true } })
      expect(getDocumentRevisionValidationDetails(error)).toEqual({ reason })
      expect(
        getDocumentRevisionValidationDetails(JSON.parse(JSON.stringify(error.report())))
      ).toEqual({ reason })
      expect(
        getDocumentRevisionValidationDetails({ code: ErrorCodes.CONFLICT, details: { reason } })
      ).toBeNull()
      expect(getDocumentStaleDetails(error)).toBeNull()
    }
  )

  it('does not treat an unrelated validation error as an old-client revision error', () => {
    expect(
      getDocumentRevisionValidationDetails(ERR_VALIDATION({ message: 'wrong path' }))
    ).toBeNull()
  })

  it('normalizes a real adapter parent conflict without changing the raw adapter contract', () => {
    let raw: unknown
    try {
      assertDocumentVersionParent({
        documentId: 'doc',
        locale: 'en',
        previousVersionId: 'old',
        currentVersionId: 'new',
      })
    } catch (error) {
      raw = error
    }
    expect(raw).toMatchObject({ code: ErrorCodes.CONFLICT, details: { reason: 'stale' } })
    const normalized = normalizeDocumentVersionParentError(raw)
    expect(normalized).toMatchObject({ code: ErrorCodes.DOCUMENT_STALE, cause: raw })
    expect(getDocumentStaleDetails(normalized)).toEqual({
      reason: 'version_parent_mismatch',
      documentId: 'doc',
      previousVersionId: 'old',
      currentVersionId: 'new',
    })
  })

  it.each([
    { reason: 'missing', documentId: 'doc', previousVersionId: null, currentVersionId: 'new' },
    { reason: 'stale' },
    { reason: 'stale', documentId: 'doc', previousVersionId: 'same', currentVersionId: 'same' },
    { reason: 'status_changed' },
    { reason: 'path_conflict' },
    { reason: 'stale_tree' },
  ])('preserves conflict identity for $reason without a valid stale-parent shape', (details) => {
    const error = ERR_CONFLICT({ message: 'conflict', details })
    expect(normalizeDocumentVersionParentError(error)).toBe(error)
  })

  it('retains existing committed-failure discriminants when adding required revision receipts', () => {
    expectTypeOf<DocumentMutationResult<DeleteDocumentResult>['outcome']>().toEqualTypeOf<
      'committed' | 'committed-with-side-effect-failures'
    >()
    expectTypeOf<
      DocumentMutationResult<DocumentHookCommittedDetails>['revision']
    >().toEqualTypeOf<number>()
    expectTypeOf<
      DocumentMutationResult<DocumentHookCommittedDetails>
    >().toExtend<DocumentRevisionReceipt>()
    expectTypeOf<{ expectedState: 'empty' }>().toExtend<SingletonSavePrecondition>()
    expectTypeOf<{ expectedRevision: number }>().toExtend<SingletonSavePrecondition>()
    expectTypeOf<Record<string, never>>().not.toExtend<SingletonSavePrecondition>()
    expectTypeOf<{
      expectedState: 'empty'
      expectedRevision: number
    }>().not.toExtend<SingletonSavePrecondition>()
  })
})
