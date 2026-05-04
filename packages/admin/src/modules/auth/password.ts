/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Password hashing — argon2id via the vendored `@noble/hashes` copy at
 * `../../vendor/noble-argon2/`. Pure-JS, runs anywhere with a modern JS
 * runtime (Node, Workers, Deno, Bun, browsers).
 *
 * Stores the full PHC string (`$argon2id$v=19$m=…$…$…`) in the
 * `byline_admin_users.password` column. That makes the algorithm and
 * parameters self-describing, so upgrading params later (or migrating off
 * argon2id entirely) is a straightforward re-hash on next successful sign-in.
 *
 * Defaults follow OWASP 2023 guidance for argon2id: memory 19 MiB,
 * iterations 2, parallelism 1. These are reasonable for typical server
 * hardware; tune if sign-in latency becomes a concern under load.
 *
 * Note: pure-JS argon2id is meaningfully slower than the previous
 * `@node-rs/argon2` Rust binding (~50–150 ms vs ~10 ms at these params on
 * modern server hardware). For interactive sign-in this is fine; for
 * high-throughput auth services consider tuning `HASH_OPTIONS` or
 * reintroducing a native binding behind a runtime-feature check.
 */

import { argon2idAsync } from '../../vendor/noble-argon2/argon2.js'
import { decodeArgon2idPhc, encodeArgon2idPhc, timingSafeEqual } from './phc.js'

/** Argon2id cost parameters. Matches the prior `@node-rs/argon2` defaults. */
const HASH_OPTIONS = {
  /** Memory cost in KiB (19 MiB). */
  memoryCost: 19456,
  /** Iterations. */
  timeCost: 2,
  /** Parallelism (lanes). */
  parallelism: 1,
  /** Derived-key length in bytes — 32 matches the prior stored hashes. */
  hashLength: 32,
  /** Salt length in bytes — 16 matches the prior stored hashes. */
  saltLength: 16,
} as const

/** Argon2 v1.3 (RFC 9106). */
const ARGON2_VERSION = 0x13

function randomSalt(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

/** Hash a plaintext password. Returns a full PHC string. */
export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length === 0) {
    throw new Error('hashPassword: plaintext must be non-empty')
  }
  const salt = randomSalt(HASH_OPTIONS.saltLength)
  const hash = await argon2idAsync(plaintext, salt, {
    m: HASH_OPTIONS.memoryCost,
    t: HASH_OPTIONS.timeCost,
    p: HASH_OPTIONS.parallelism,
    dkLen: HASH_OPTIONS.hashLength,
    version: ARGON2_VERSION,
  })
  return encodeArgon2idPhc({
    algorithm: 'argon2id',
    version: ARGON2_VERSION,
    memoryCost: HASH_OPTIONS.memoryCost,
    timeCost: HASH_OPTIONS.timeCost,
    parallelism: HASH_OPTIONS.parallelism,
    salt,
    hash,
  })
}

/**
 * Verify a plaintext password against a stored PHC string. Returns `false`
 * on mismatch — never throws for a normal mismatch. Re-throws on malformed
 * hash strings or underlying library errors so those get surfaced.
 */
export async function verifyPassword(plaintext: string, phc: string): Promise<boolean> {
  if (plaintext.length === 0 || phc.length === 0) return false
  const decoded = decodeArgon2idPhc(phc)
  const candidate = await argon2idAsync(plaintext, decoded.salt, {
    m: decoded.memoryCost,
    t: decoded.timeCost,
    p: decoded.parallelism,
    dkLen: decoded.hash.length,
    version: decoded.version,
  })
  return timingSafeEqual(candidate, decoded.hash)
}
