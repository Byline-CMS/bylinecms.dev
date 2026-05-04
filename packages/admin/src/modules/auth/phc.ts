/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * PHC (Password Hashing Competition) string format encode / decode for argon2id.
 *
 * Format:
 *   $argon2id$v=<ver>$m=<mem>,t=<iter>,p=<para>$<saltB64>$<hashB64>
 *
 * Where `saltB64` and `hashB64` use the PHC "B64" alphabet — standard base64
 * without trailing `=` padding. Matches the wire format produced by
 * `@node-rs/argon2` and `argon2-cffi`, so existing password column rows keep
 * verifying after the cutover.
 *
 * Implemented against the Web-standard `btoa` / `atob` (available in Node ≥ 16,
 * browsers, Workers, Deno, Bun) so this module has no Node-specific surface.
 */

export type Argon2idPhc = {
  /** Always `'argon2id'` for this codebase. */
  algorithm: 'argon2id'
  /** Argon2 version number — `0x13` (decimal 19) since RFC 9106. */
  version: number
  /** Memory cost in KiB. */
  memoryCost: number
  /** Iterations. */
  timeCost: number
  /** Parallelism (lanes). */
  parallelism: number
  /** Raw salt bytes. */
  salt: Uint8Array
  /** Raw derived-key bytes. */
  hash: Uint8Array
}

function bytesToB64NoPad(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/=+$/, '')
}

function b64NoPadToBytes(b64: string): Uint8Array {
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeArgon2idPhc(phc: Argon2idPhc): string {
  return (
    `$${phc.algorithm}` +
    `$v=${phc.version}` +
    `$m=${phc.memoryCost},t=${phc.timeCost},p=${phc.parallelism}` +
    `$${bytesToB64NoPad(phc.salt)}` +
    `$${bytesToB64NoPad(phc.hash)}`
  )
}

export function decodeArgon2idPhc(s: string): Argon2idPhc {
  // Leading `$` produces an empty first segment, so a valid argon2id PHC string
  // splits into exactly 6 parts: ['', algo, 'v=…', 'm=…,t=…,p=…', salt, hash].
  const parts = s.split('$') as (string | undefined)[]
  if (parts.length !== 6 || parts[0] !== '') {
    throw new Error('decodeArgon2idPhc: malformed PHC string')
  }
  const algorithm = parts[1] ?? ''
  const versionField = parts[2] ?? ''
  const paramsField = parts[3] ?? ''
  const saltB64 = parts[4] ?? ''
  const hashB64 = parts[5] ?? ''
  if (algorithm !== 'argon2id') {
    throw new Error(`decodeArgon2idPhc: unsupported algorithm "${algorithm}"`)
  }
  if (!versionField.startsWith('v=')) {
    throw new Error('decodeArgon2idPhc: missing version field')
  }
  const version = Number.parseInt(versionField.slice(2), 10)
  if (!Number.isInteger(version)) {
    throw new Error(`decodeArgon2idPhc: invalid version "${versionField}"`)
  }

  const params: Partial<Record<'m' | 't' | 'p', number>> = {}
  for (const kv of paramsField.split(',')) {
    const eq = kv.indexOf('=')
    if (eq <= 0) throw new Error(`decodeArgon2idPhc: malformed param "${kv}"`)
    const k = kv.slice(0, eq)
    const v = Number.parseInt(kv.slice(eq + 1), 10)
    if (!Number.isInteger(v)) throw new Error(`decodeArgon2idPhc: malformed param value "${kv}"`)
    if (k === 'm' || k === 't' || k === 'p') params[k] = v
  }
  if (params.m === undefined || params.t === undefined || params.p === undefined) {
    throw new Error('decodeArgon2idPhc: missing required m/t/p params')
  }

  return {
    algorithm: 'argon2id',
    version,
    memoryCost: params.m,
    timeCost: params.t,
    parallelism: params.p,
    salt: b64NoPadToBytes(saltB64),
    hash: b64NoPadToBytes(hashB64),
  }
}

/**
 * Constant-time byte comparison. Returns `true` only if both arrays have the
 * same length and every byte matches. Intended for hash verification.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}
