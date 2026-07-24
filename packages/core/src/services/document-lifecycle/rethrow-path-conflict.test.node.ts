/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { type DbErrorClassification, ErrorCodes } from '../../lib/errors.js'
import { rethrowPathConflict } from './internals.js'
import type { IDbAdapter } from '../../@types/index.js'

const adapterWith = (c: DbErrorClassification | undefined): IDbAdapter =>
  ({ classifyError: c === undefined ? undefined : () => c }) as unknown as IDbAdapter

describe('rethrowPathConflict', () => {
  it('maps a unique violation on the path constraint to ERR_PATH_CONFLICT', () => {
    const db = adapterWith({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'byline_document_paths_document_paths_collection_locale_path',
    })
    try {
      rethrowPathConflict(db, new Error('raw'), 'news/hello', 'en')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { code?: string }).code).toBe(ErrorCodes.PATH_CONFLICT)
    }
  })

  it('rethrows raw when the unique violation is on a different constraint', () => {
    const raw = new Error('raw')
    const db = adapterWith({ code: 'DB_UNIQUE_VIOLATION', constraint: 'some_other_unique' })
    expect(() => rethrowPathConflict(db, raw, 'p', 'en')).toThrow(raw)
  })

  it('rethrows raw for DB_UNKNOWN', () => {
    const raw = new Error('raw')
    const db = adapterWith({ code: 'DB_UNKNOWN' })
    expect(() => rethrowPathConflict(db, raw, 'p', 'en')).toThrow(raw)
  })

  it('rethrows raw when the adapter has no classifyError', () => {
    const raw = new Error('raw')
    const db = adapterWith(undefined)
    expect(() => rethrowPathConflict(db, raw, 'p', 'en')).toThrow(raw)
  })
})
