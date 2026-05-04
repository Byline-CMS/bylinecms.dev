/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Fidelity check for the vendored noble-argon2 copy.
 *
 * Each vector below is taken verbatim from the noble-hashes test suite at the
 * pinned upstream commit (see ../src/vendor/noble-argon2/README.md), which in
 * turn references the P-H-C `phc-winner-argon2` reference KATs and `test.c`
 * vectors. If any vector fails, the vendored algorithm has drifted from the
 * upstream RFC 9106 implementation and must not be used.
 *
 * Vectors are the modest-cost ones (m ≤ 65536) so the suite runs in reasonable
 * time. The high-memory `m=262144` reference vector is intentionally omitted.
 */

import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from '../src/modules/auth/password.js'
import { decodeArgon2idPhc, encodeArgon2idPhc } from '../src/modules/auth/phc.js'
import { argon2id, argon2idAsync } from '../src/vendor/noble-argon2/argon2.js'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type Vector = {
  description: string
  password: string
  salt: string
  m: number
  t: number
  p: number
  exp: string
}

// All argon2id, dkLen=32 (noble default), version 0x13 (noble default).
// Source: https://github.com/paulmillr/noble-hashes/blob/<pinned>/test/argon2.test.ts
const VECTORS: Vector[] = [
  {
    description: 'argon2id m=65536 t=2 p=1 "password"/"somesalt"',
    password: 'password',
    salt: 'somesalt',
    m: 65536,
    t: 2,
    p: 1,
    exp: '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7',
  },
  {
    description: 'argon2id m=256 t=2 p=1 "password"/"somesalt"',
    password: 'password',
    salt: 'somesalt',
    m: 256,
    t: 2,
    p: 1,
    exp: '9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe',
  },
  {
    description: 'argon2id m=256 t=2 p=2 "password"/"somesalt"',
    password: 'password',
    salt: 'somesalt',
    m: 256,
    t: 2,
    p: 2,
    exp: '6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037',
  },
  {
    description: 'argon2id m=65536 t=1 p=1 "password"/"somesalt"',
    password: 'password',
    salt: 'somesalt',
    m: 65536,
    t: 1,
    p: 1,
    exp: 'f6a5adc1ba723dddef9b5ac1d464e180fcd9dffc9d1cbf76cca2fed795d9ca98',
  },
  {
    description: 'argon2id m=65536 t=4 p=1 "password"/"somesalt"',
    password: 'password',
    salt: 'somesalt',
    m: 65536,
    t: 4,
    p: 1,
    exp: '9025d48e68ef7395cca9079da4c4ec3affb3c8911fe4f86d1a2520856f63172c',
  },
  {
    description: 'argon2id m=65536 t=2 p=1 "differentpassword"/"somesalt"',
    password: 'differentpassword',
    salt: 'somesalt',
    m: 65536,
    t: 2,
    p: 1,
    exp: '0b84d652cf6b0c4beaef0dfe278ba6a80df6696281d7e0d2891b817d8c458fde',
  },
  {
    description: 'argon2id m=65536 t=2 p=1 "password"/"diffsalt"',
    password: 'password',
    salt: 'diffsalt',
    m: 65536,
    t: 2,
    p: 1,
    exp: 'bdf32b05ccc42eb15d58fd19b1f856b113da1e9a5874fdcc544308565aa8141c',
  },
]

describe('vendored noble-argon2 — published test vectors', () => {
  // Per-suite timeout is set in vitest.config.ts (30 s) — pure-JS argon2id at
  // m=65536 t=4 takes a few seconds on typical hardware.
  for (const v of VECTORS) {
    it(v.description, () => {
      const out = argon2id(v.password, v.salt, { m: v.m, t: v.t, p: v.p })
      expect(bytesToHex(out)).toBe(v.exp)
    })
  }

  it('async variant matches sync variant for the same input', async () => {
    const v = VECTORS[1]! // small one — fast
    const sync = argon2id(v.password, v.salt, { m: v.m, t: v.t, p: v.p })
    const asyncOut = await argon2idAsync(v.password, v.salt, { m: v.m, t: v.t, p: v.p })
    expect(bytesToHex(asyncOut)).toBe(bytesToHex(sync))
  })
})

describe('PHC encode/decode round-trip', () => {
  it('round-trips a freshly-built PHC value', () => {
    const phc = {
      algorithm: 'argon2id' as const,
      version: 0x13,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      salt: new Uint8Array(16).fill(0xab),
      hash: new Uint8Array(32).fill(0xcd),
    }
    const s = encodeArgon2idPhc(phc)
    expect(s).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    const decoded = decodeArgon2idPhc(s)
    expect(decoded.algorithm).toBe('argon2id')
    expect(decoded.version).toBe(0x13)
    expect(decoded.memoryCost).toBe(19456)
    expect(decoded.timeCost).toBe(2)
    expect(decoded.parallelism).toBe(1)
    expect(Array.from(decoded.salt)).toEqual(Array.from(phc.salt))
    expect(Array.from(decoded.hash)).toEqual(Array.from(phc.hash))
  })

  it('emits PHC strings that decode back to the same bytes for a real argon2 hash', () => {
    // Tie the encoder/decoder to the known vector: derive the hash, embed it
    // in a PHC string, decode it, and confirm byte-for-byte symmetry plus the
    // expected wire format.
    const v = VECTORS[0]
    const hash = argon2id(v.password, v.salt, { m: v.m, t: v.t, p: v.p })
    const saltBytes = new TextEncoder().encode(v.salt)
    const s = encodeArgon2idPhc({
      algorithm: 'argon2id',
      version: 0x13,
      memoryCost: v.m,
      timeCost: v.t,
      parallelism: v.p,
      salt: saltBytes,
      hash,
    })
    expect(s).toMatch(/^\$argon2id\$v=19\$m=65536,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
    const decoded = decodeArgon2idPhc(s)
    expect(new TextDecoder().decode(decoded.salt)).toBe(v.salt)
    expect(bytesToHex(decoded.hash)).toBe(v.exp)
  })

  it('rejects malformed PHC strings', () => {
    expect(() => decodeArgon2idPhc('not a phc string')).toThrow()
    expect(() => decodeArgon2idPhc('$argon2id$v=19$m=8,t=1,p=1$abc')).toThrow()
    expect(() => decodeArgon2idPhc('$bcrypt$v=19$m=8,t=1,p=1$abc$def')).toThrow(/unsupported/)
  })
})

describe('hashPassword / verifyPassword end-to-end', () => {
  it('round-trips through the password.ts public API', async () => {
    const phc = await hashPassword('correct horse battery staple')
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(await verifyPassword('correct horse battery staple', phc)).toBe(true)
    expect(await verifyPassword('wrong password', phc)).toBe(false)
  })
})
