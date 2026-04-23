/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'

import { hashPassword, verifyPassword } from '../password.js'

describe('password hashing (argon2id)', () => {
  it('round-trips — hashed plaintext verifies true', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const ok = await verifyPassword('correct horse battery staple', hash)
    assert.strictEqual(ok, true)
  })

  it('returns false on mismatch', async () => {
    const hash = await hashPassword('right-answer')
    const ok = await verifyPassword('wrong-answer', hash)
    assert.strictEqual(ok, false)
  })

  it('produces a PHC string starting with $argon2id$', async () => {
    const hash = await hashPassword('whatever')
    assert.match(hash, /^\$argon2id\$/)
  })

  it('different hashes for the same password (unique salts)', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    assert.notStrictEqual(a, b)
    // But both verify
    assert.strictEqual(await verifyPassword('same-password', a), true)
    assert.strictEqual(await verifyPassword('same-password', b), true)
  })

  it('throws on empty plaintext at hash time', async () => {
    await assert.rejects(() => hashPassword(''), /non-empty/)
  })

  it('verify returns false on empty inputs rather than throwing', async () => {
    const hash = await hashPassword('x')
    assert.strictEqual(await verifyPassword('', hash), false)
    assert.strictEqual(await verifyPassword('x', ''), false)
  })
})
