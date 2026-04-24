/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from '../src/modules/auth/password.js'

describe('password hashing (argon2id)', () => {
  it('round-trips — hashed plaintext verifies true', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const ok = await verifyPassword('correct horse battery staple', hash)
    expect(ok).toBe(true)
  })

  it('returns false on mismatch', async () => {
    const hash = await hashPassword('right-answer')
    const ok = await verifyPassword('wrong-answer', hash)
    expect(ok).toBe(false)
  })

  it('produces a PHC string starting with $argon2id$', async () => {
    const hash = await hashPassword('whatever')
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  it('different hashes for the same password (unique salts)', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    // But both verify
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('throws on empty plaintext at hash time', async () => {
    await expect(() => hashPassword('')).rejects.toThrow(/non-empty/)
  })

  it('verify returns false on empty inputs rather than throwing', async () => {
    const hash = await hashPassword('x')
    expect(await verifyPassword('', hash)).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })
})
