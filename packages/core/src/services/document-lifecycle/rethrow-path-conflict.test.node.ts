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
  it.each([
    [
      'create',
      'cannot create a document at path "news/hello" because a live document already uses it in this collection (locale: en)',
    ],
    [
      'update',
      'cannot update this document to path "news/hello" because a live document already uses it in this collection (locale: en)',
    ],
    [
      'duplicate',
      'cannot duplicate this document to path "news/hello" because a live document already uses it in this collection (locale: en)',
    ],
  ] as const)(
    'maps a path unique violation for %s with live-occupant language',
    (operation, message) => {
      const constraint = 'byline_document_paths_document_paths_collection_locale_path'
      const db = adapterWith({
        code: 'DB_UNIQUE_VIOLATION',
        constraint,
      })
      try {
        rethrowPathConflict(db, new Error('raw'), 'news/hello', 'en', operation)
        throw new Error('should have thrown')
      } catch (e) {
        expect(e).toMatchObject({
          code: ErrorCodes.PATH_CONFLICT,
          message,
          details: { path: 'news/hello', locale: 'en', constraint },
        })
        expect((e as { details?: Record<string, unknown> }).details).not.toHaveProperty(
          'documentId'
        )
      }
    }
  )

  it('rethrows raw when the unique violation is on a different constraint', () => {
    const raw = new Error('raw')
    const db = adapterWith({ code: 'DB_UNIQUE_VIOLATION', constraint: 'some_other_unique' })
    expect(() => rethrowPathConflict(db, raw, 'p', 'en', 'create')).toThrow(raw)
  })

  it('rethrows raw for DB_UNKNOWN', () => {
    const raw = new Error('raw')
    const db = adapterWith({ code: 'DB_UNKNOWN' })
    expect(() => rethrowPathConflict(db, raw, 'p', 'en', 'create')).toThrow(raw)
  })

  it('rethrows raw when the adapter has no classifyError', () => {
    const raw = new Error('raw')
    const db = adapterWith(undefined)
    expect(() => rethrowPathConflict(db, raw, 'p', 'en', 'create')).toThrow(raw)
  })
})
