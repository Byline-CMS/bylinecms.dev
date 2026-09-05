/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DOCUMENT_HOOK_COMMITTED, ErrorCodes } from '@byline/core'
import { describe, expect, it } from 'vitest'

import {
  hasCommittedDocumentHookFailure,
  toCommittedDocumentHookFailureResponse,
} from './save-outcome.js'

describe('collection save outcome transport', () => {
  it('returns only allowlisted committed hook metadata', () => {
    const error = ERR_DOCUMENT_HOOK_COMMITTED({
      message: 'internal message',
      cause: new Error('secret hook failure'),
      details: {
        phase: 'afterCreate',
        documentId: 'doc-1',
        documentVersionId: 'version-1',
        revision: 2,
        sideEffectCode: ErrorCodes.STORAGE,
        privatePath: '/private/cache/key',
      },
    })

    const response = toCommittedDocumentHookFailureResponse(error)

    expect(response).toEqual({
      status: 'committed-hook-failed',
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      revision: 2,
      sideEffectFailure: { phase: 'afterCreate', code: 'ERR_STORAGE' },
    })
    expect(JSON.stringify(response)).not.toContain('secret hook failure')
    expect(JSON.stringify(response)).not.toContain('/private/cache/key')
    expect(hasCommittedDocumentHookFailure(response)).toBe(true)
  })

  it('accepts the singleton afterSave phase exported by core', () => {
    const response = toCommittedDocumentHookFailureResponse(
      ERR_DOCUMENT_HOOK_COMMITTED({
        message: 'singleton committed',
        details: {
          phase: 'afterSave',
          documentId: 'doc-singleton',
          documentVersionId: 'version-singleton',
          revision: 2,
          sideEffectCode: ErrorCodes.UNHANDLED,
        },
      })
    )

    expect(response?.sideEffectFailure).toEqual({
      phase: 'afterSave',
      code: ErrorCodes.UNHANDLED,
    })
  })

  it('does not classify ordinary or malformed failures as committed', () => {
    expect(toCommittedDocumentHookFailureResponse(new Error('write failed'))).toBeNull()
    expect(
      toCommittedDocumentHookFailureResponse({
        code: ErrorCodes.DOCUMENT_HOOK_COMMITTED,
        message: 'missing ids',
        details: {
          phase: 'afterUpdate',
          sideEffectCode: ErrorCodes.UNHANDLED,
        },
      })
    ).toBeNull()
    expect(hasCommittedDocumentHookFailure({ status: 'ok' })).toBe(false)
  })
})
