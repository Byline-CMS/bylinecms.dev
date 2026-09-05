import { describe, expect, it } from 'vitest'

import { ErrorCodes } from '../lib/errors.js'
import {
  documentRevisionFromDatabase,
  isDocumentRevision,
  parseDocumentRevision,
} from './document-revision.js'

describe('document revisions', () => {
  it.each([1, 2, Number.MAX_SAFE_INTEGER])('accepts observed revision %s unchanged', (value) => {
    expect(isDocumentRevision(value)).toBe(true)
    expect(parseDocumentRevision(value)).toBe(value)
  })

  it.each([null, '1', 1n, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []])(
    'rejects invalid caller input %s without coercion',
    (value) => {
      expect(isDocumentRevision(value)).toBe(false)
      expect(() => parseDocumentRevision(value)).toThrowError(
        expect.objectContaining({
          code: ErrorCodes.VALIDATION,
          details: { reason: 'invalid_document_revision' },
        })
      )
    }
  )

  it('distinguishes an omitted revision from malformed input', () => {
    expect(() => parseDocumentRevision(undefined)).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.VALIDATION,
        details: { reason: 'missing_document_revision' },
      })
    )
  })

  it.each([1, '1', 1n, Number.MAX_SAFE_INTEGER, '9007199254740991', 9007199254740991n])(
    'converts the database representation %s exactly',
    (value) => expect(documentRevisionFromDatabase(value)).toBe(Number(value))
  )

  it.each([
    undefined,
    null,
    0,
    -1,
    1.2,
    NaN,
    Infinity,
    '01',
    '+1',
    '1.0',
    '1e1',
    ' 1',
    '1 ',
    '1\n',
    '',
    '9007199254740992',
    '9007199254740993',
    9007199254740992n,
    -1n,
    Number.MAX_SAFE_INTEGER + 1,
    { valueOf: () => 1 },
  ])('rejects malformed/overflowing storage value %s', (value) => {
    expect(() => documentRevisionFromDatabase(value)).toThrowError(
      expect.objectContaining({ code: ErrorCodes.DATABASE })
    )
  })
})
