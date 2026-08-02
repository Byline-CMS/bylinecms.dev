/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveSignInHomeUrl } from './sign-in-home-url.js'

describe('resolveSignInHomeUrl', () => {
  it('defaults the sign-in Home link to the same-origin root', () => {
    expect(resolveSignInHomeUrl(undefined)).toBe('/')
  })

  it('preserves an explicit host-owned Home URL', () => {
    expect(resolveSignInHomeUrl('https://example.test/')).toBe('https://example.test/')
  })
})
