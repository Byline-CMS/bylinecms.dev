/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Browser-safe content-identity helpers. Web Crypto (`globalThis.crypto.subtle`)
// keeps this module free of Node built-ins so it can sit in the main entry's
// module graph. Incremental (streamed) hashing needs `node:crypto` and lives in
// the server-only `@byline/core/stored-files` entry.

import type { StorageValidator } from '../@types/storage-types.js'

/** A `StoredFileValue.fileHash`: SHA-256 as 64 lower-case hexadecimal characters. */
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/

/** Upper bounds for `StorageValidator` members. */
export const STORAGE_VALIDATOR_LIMITS = { kind: 32, value: 1024 } as const

/** SHA-256 of an in-memory byte sequence, as lower-case hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer view: `digest` rejects SharedArrayBuffer-backed
  // views, and a Node Buffer may be a slice of a larger pooled allocation.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Exact validator equality: both `kind` and `value` must match. Validators of
 * different kinds are not comparable, so this returns `false` for them — the
 * caller must treat that as "unknown", not "changed".
 */
export function isSameStorageValidator(a: StorageValidator, b: StorageValidator): boolean {
  return a.kind === b.kind && a.value === b.value
}
