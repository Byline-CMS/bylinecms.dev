/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { classifyError } from './classify-error.js'

describe('classifyError (postgres)', () => {
  it('classifies a raw 23505 as DB_UNIQUE_VIOLATION with the constraint', () => {
    const err = { code: '23505', constraint: 'document_paths_collection_locale_path' }
    expect(classifyError(err)).toEqual({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'document_paths_collection_locale_path',
    })
  })

  it('walks a Drizzle-style cause chain to the underlying pg error', () => {
    const err = {
      name: 'DrizzleQueryError',
      cause: { code: '23505', constraint: 'some_other_unique' },
    }
    expect(classifyError(err)).toEqual({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'some_other_unique',
    })
  })

  it('classifies a raw 23503 as DB_FOREIGN_KEY_VIOLATION with the constraint', () => {
    expect(classifyError({ code: '23503', constraint: 'fk_document_owner' })).toEqual({
      code: 'DB_FOREIGN_KEY_VIOLATION',
      constraint: 'fk_document_owner',
    })
  })

  it('returns DB_UNKNOWN for an unrelated database error', () => {
    expect(classifyError({ code: '22000' })).toEqual({ code: 'DB_UNKNOWN' })
  })

  it('returns DB_UNKNOWN for a non-error value', () => {
    expect(classifyError(undefined)).toEqual({ code: 'DB_UNKNOWN' })
    expect(classifyError('boom')).toEqual({ code: 'DB_UNKNOWN' })
  })
})

describe('lock conflict classification', () => {
  it.each(['40P01', '40001', '55P03'])(
    'classifies driver lock failure %s through a cause',
    (value) => {
      expect(classifyError({ cause: { code: value } })).toEqual({ code: 'DB_LOCK_CONFLICT' })
    }
  )
  it('does not classify connection loss as safe contention', () => {
    expect(classifyError({ code: 'ECONNRESET', errno: 2013 })).toEqual({ code: 'DB_UNKNOWN' })
  })
})
