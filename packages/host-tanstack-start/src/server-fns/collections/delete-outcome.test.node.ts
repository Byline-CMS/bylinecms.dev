/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DeleteDocumentSideEffectPhase } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { hasDeleteSideEffectFailures, toDeleteDocumentResponse } from './delete-outcome.js'

describe('delete outcome transport and admin interpretation', () => {
  it('returns only allowlisted phase/code data for a committed warning', () => {
    const response = toDeleteDocumentResponse({
      deletedVersionCount: 2,
      outcome: 'committed-with-side-effect-failures',
      sideEffectFailures: [
        { phase: 'afterDelete', message: 'secret hook details', code: 'ERR_SEARCH' },
        { phase: 'storageCleanup', message: 'private/path.pdf', code: 'ERR_STORAGE' },
        {
          phase: 'internalOnly' as DeleteDocumentSideEffectPhase,
          message: 'internal phase details',
          code: 'ERR_INTERNAL',
        },
      ],
    })

    expect(response).toEqual({
      status: 'ok',
      deletedVersionCount: 2,
      outcome: 'committed-with-side-effect-failures',
      sideEffectFailures: [
        { phase: 'afterDelete', code: 'ERR_UNHANDLED' },
        { phase: 'storageCleanup', code: 'ERR_STORAGE' },
        { phase: 'unknown', code: 'ERR_UNHANDLED' },
      ],
    })
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
    expect(JSON.stringify(response)).not.toContain('secret hook details')
    expect(JSON.stringify(response)).not.toContain('private/path.pdf')
    expect(JSON.stringify(response)).not.toContain('internal phase details')
    expect(hasDeleteSideEffectFailures(response)).toBe(true)
  })

  it('preserves the committed success discriminant and empty failures', () => {
    const response = toDeleteDocumentResponse({
      deletedVersionCount: 2,
      outcome: 'committed',
      sideEffectFailures: [],
    })

    expect(response).toEqual({
      status: 'ok',
      deletedVersionCount: 2,
      outcome: 'committed',
      sideEffectFailures: [],
    })
    expect(hasDeleteSideEffectFailures(response)).toBe(false)
  })

  it('classifies only committed side-effect failures as an admin warning', () => {
    expect(hasDeleteSideEffectFailures({ outcome: 'committed' })).toBe(false)
    expect(hasDeleteSideEffectFailures({ outcome: 'committed-with-side-effect-failures' })).toBe(
      true
    )
  })
})
