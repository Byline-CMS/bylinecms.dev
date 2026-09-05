/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { runClassifyErrorContract } from '@byline/db-conformance'
import { describe, expect, it } from 'vitest'

import { classifyError } from './classify-error.js'

describe('classifyError (mysql)', () => {
  it('classifies a raw ER_DUP_ENTRY (errno 1062) as DB_UNIQUE_VIOLATION with the bare index name', () => {
    const err = {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlState: '23000',
      message: "Duplicate entry '1' for key 't_dup.idx_document_paths_collection_locale_path'",
    }
    expect(classifyError(err)).toEqual({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'idx_document_paths_collection_locale_path',
    })
  })

  it('walks a Drizzle-style cause chain to the underlying mysql2 error', () => {
    const err = {
      name: 'DrizzleQueryError',
      cause: {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
        sqlState: '23000',
        message: "Duplicate entry '2' for key 'byline_document_paths.some_other_unique'",
      },
    }
    expect(classifyError(err)).toEqual({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'some_other_unique',
    })
  })

  it('matches on the numeric errno, not the code string', () => {
    // Same errno, a code string that would not stringwise-match anything —
    // classification still succeeds because the match is on `errno`.
    const err = {
      code: 'SOME_OTHER_CODE',
      errno: 1062,
      message: "Duplicate entry '1' for key 't.idx_x'",
    }
    expect(classifyError(err).code).toBe('DB_UNIQUE_VIOLATION')
  })

  it('classifies a foreign-key error with the constraint name', () => {
    expect(
      classifyError({
        code: 'ER_NO_REFERENCED_ROW_2',
        errno: 1452,
        sqlState: '23000',
        message:
          'Cannot add or update a child row: a foreign key constraint fails (`db`.`table`, CONSTRAINT `fk_document_owner` FOREIGN KEY (`document_id`))',
      })
    ).toEqual({
      code: 'DB_FOREIGN_KEY_VIOLATION',
      constraint: 'fk_document_owner',
    })
  })

  it('returns DB_UNKNOWN for an unrelated database error', () => {
    expect(classifyError({ code: 'ER_DATA_TOO_LONG', errno: 1406 })).toEqual({
      code: 'DB_UNKNOWN',
    })
  })

  it('returns DB_UNKNOWN for a non-error value', () => {
    expect(classifyError(undefined)).toEqual({ code: 'DB_UNKNOWN' })
    expect(classifyError('boom')).toEqual({ code: 'DB_UNKNOWN' })
    expect(classifyError(null)).toEqual({ code: 'DB_UNKNOWN' })
  })
})

runClassifyErrorContract([
  {
    adapterName: 'mysql',
    classifyError,
    uniqueViolationError: {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlState: '23000',
      message:
        "Duplicate entry 'some-uuid' for key 'byline_document_paths.idx_document_paths_collection_locale_path'",
    },
    nestedUniqueViolationError: {
      name: 'DrizzleQueryError',
      cause: {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
        sqlState: '23000',
        message:
          "Duplicate entry 'some-uuid' for key 'byline_document_paths.idx_document_paths_collection_locale_path'",
      },
    },
    foreignKeyViolationError: {
      name: 'DrizzleQueryError',
      cause: {
        code: 'ER_NO_REFERENCED_ROW_2',
        errno: 1452,
        sqlState: '23000',
        message:
          'Cannot add or update a child row: a foreign key constraint fails (`db`.`table`, CONSTRAINT `fk_document_owner` FOREIGN KEY (`document_id`))',
      },
    },
    unrelatedError: { code: 'ER_DATA_TOO_LONG', errno: 1406, sqlState: '22001' },
  },
])

describe('lock conflict classification', () => {
  it.each([1213, 1205])('classifies driver lock failure %s through a cause', (value) => {
    expect(classifyError({ cause: { errno: value } })).toEqual({ code: 'DB_LOCK_CONFLICT' })
  })
  it('does not classify connection loss as safe contention', () => {
    expect(classifyError({ code: 'ECONNRESET', errno: 2013 })).toEqual({ code: 'DB_UNKNOWN' })
  })
})
