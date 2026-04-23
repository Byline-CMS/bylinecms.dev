/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Password hashing — argon2id via @node-rs/argon2.
 *
 * Stores the full PHC string (`$argon2id$v=19$m=…$…$…`) in the
 * `byline_admin_users.password` column. That makes the algorithm and
 * parameters self-describing, so upgrading params later (or migrating off
 * argon2id entirely) is a straightforward re-hash on next successful sign-in.
 *
 * Defaults follow OWASP 2023 guidance for argon2id: memory 19 MiB,
 * iterations 2, parallelism 1. These are reasonable for typical server
 * hardware; tune if sign-in latency becomes a concern under load.
 */

import { hash, verify } from '@node-rs/argon2'

/**
 * `@node-rs/argon2` defaults to argon2id; we just tune the parameters.
 * (The `Algorithm` enum exported by the package is a const enum and
 * cannot be referenced under `verbatimModuleSyntax`.)
 */
const HASH_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
}

/** Hash a plaintext password. Returns a full PHC string. */
export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length === 0) {
    throw new Error('hashPassword: plaintext must be non-empty')
  }
  return hash(plaintext, HASH_OPTIONS)
}

/**
 * Verify a plaintext password against a stored PHC string. Returns `false`
 * on mismatch — never throws for a normal mismatch. Re-throws on malformed
 * hash strings or underlying library errors so those get surfaced.
 */
export async function verifyPassword(plaintext: string, phc: string): Promise<boolean> {
  if (plaintext.length === 0 || phc.length === 0) return false
  return verify(phc, plaintext)
}
