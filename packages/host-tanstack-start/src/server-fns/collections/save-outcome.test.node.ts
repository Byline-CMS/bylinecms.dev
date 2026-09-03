/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  hasCommittedDocumentHookFailure,
  toCommittedDocumentHookFailureResponse,
} from './save-outcome.js'

describe('collection save outcome transport', () => {
  it('returns only allowlisted committed hook metadata', () => {
    const error = {
      code: 'ERR_DOCUMENT_HOOK_COMMITTED',
      message: 'internal message',
      cause: new Error('secret hook failure'),
      details: {
        phase: 'afterCreate',
        documentId: 'doc-1',
        documentVersionId: 'version-1',
        sideEffectCode: 'ERR_STORAGE',
        privatePath: '/private/cache/key',
      },
    }

    const response = toCommittedDocumentHookFailureResponse(error)

    expect(response).toEqual({
      status: 'committed-hook-failed',
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      sideEffectFailure: { phase: 'afterCreate', code: 'ERR_STORAGE' },
    })
    expect(JSON.stringify(response)).not.toContain('secret hook failure')
    expect(JSON.stringify(response)).not.toContain('/private/cache/key')
    expect(hasCommittedDocumentHookFailure(response as { status: string })).toBe(true)
  })

  it('does not classify ordinary or malformed failures as committed', () => {
    expect(toCommittedDocumentHookFailureResponse(new Error('write failed'))).toBeNull()
    expect(
      toCommittedDocumentHookFailureResponse({
        code: 'ERR_DOCUMENT_HOOK_COMMITTED',
        message: 'missing ids',
        details: {
          phase: 'afterUpdate',
          sideEffectCode: 'ERR_UNHANDLED',
        },
      })
    ).toBeNull()
    expect(hasCommittedDocumentHookFailure({ status: 'ok' })).toBe(false)
  })
})
