/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { passwordSchema, passwordSignInSchema } from './shared.js'

describe('password sign-in validation', () => {
  it('accepts legacy credentials without imposing enrollment policy', () => {
    expect(passwordSchema.safeParse('legacy').success).toBe(false)
    expect(
      passwordSignInSchema.parse({ email: ' Admin@Example.com ', password: 'legacy' })
    ).toEqual({ email: 'admin@example.com', password: 'legacy' })
  })
  it('shares the enrollment maximum without trimming passwords', () => {
    expect(
      passwordSignInSchema.parse({ email: 'a', password: ' '.repeat(128) }).password
    ).toHaveLength(128)
    for (const password of ['', 'a'.repeat(129)])
      expect(passwordSignInSchema.safeParse({ email: 'a', password }).success).toBe(false)
    expect(
      passwordSignInSchema.safeParse({ email: 'a'.repeat(255), password: 'valid' }).success
    ).toBe(false)
  })
})
