/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  AuthError,
  AuthErrorCodes,
  createRequestContext,
  createSuperAdminContext,
} from '@byline/auth'
import { describe, expect, it } from 'vitest'

import { ErrorCodes } from '../lib/errors.js'
import { assertLocaleVisibility } from './assert-locale-visibility.js'

const anonymous = createRequestContext({ actor: null, readMode: 'published' })
const admin = createSuperAdminContext({ id: 'test-admin' })

describe('assertLocaleVisibility', () => {
  it('permits an anonymous public read of a single locale', () => {
    expect(() => assertLocaleVisibility(anonymous, 'pages', 'public', 'es')).not.toThrow()
  })

  it('rejects an anonymous editorial read even with readMode published', () => {
    try {
      assertLocaleVisibility(anonymous, 'pages', 'editorial', 'es')
      expect.fail('expected ERR_UNAUTHENTICATED')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
    }
  })

  it('rejects an editorial read with no context', () => {
    expect(() => assertLocaleVisibility(undefined, 'pages', 'editorial', 'es')).toThrow(AuthError)
  })

  it('permits an authenticated editorial read, including locale all', () => {
    expect(() => assertLocaleVisibility(admin, 'pages', 'editorial', 'es')).not.toThrow()
    expect(() => assertLocaleVisibility(admin, 'pages', 'editorial', 'all')).not.toThrow()
  })

  it('rejects a public locale all read, even for an authenticated actor', () => {
    for (const ctx of [anonymous, admin]) {
      try {
        assertLocaleVisibility(ctx, 'pages', 'public', 'all')
        expect.fail('expected ERR_VALIDATION')
      } catch (err) {
        expect((err as { code?: string }).code).toBe(ErrorCodes.VALIDATION)
      }
    }
  })
})
