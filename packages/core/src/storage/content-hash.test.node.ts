/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { fieldToZodSchema } from '../schemas/zod/builder.js'
import { CONTENT_HASH_PATTERN, isSameStorageValidator, sha256Hex } from './content-hash.js'

// FIPS 180-2 test vectors.
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('content hash helpers', () => {
  it('computes SHA-256 as lower-case hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC_SHA256)
    expect(await sha256Hex(new Uint8Array())).toBe(EMPTY_SHA256)
  })

  it('hashes only the viewed bytes of a sliced Buffer', async () => {
    const pooled = Buffer.from('xxabcxx')
    expect(await sha256Hex(pooled.subarray(2, 5))).toBe(ABC_SHA256)
  })

  it('compares validators by exact kind and value', () => {
    const a = { kind: 's3-etag', value: 'abc' }
    expect(isSameStorageValidator(a, { kind: 's3-etag', value: 'abc' })).toBe(true)
    expect(isSameStorageValidator(a, { kind: 's3-etag', value: 'abd' })).toBe(false)
    expect(isSameStorageValidator(a, { kind: 's3-version', value: 'abc' })).toBe(false)
  })

  it('matches only 64 lower-case hex characters', () => {
    expect(CONTENT_HASH_PATTERN.test(ABC_SHA256)).toBe(true)
    expect(CONTENT_HASH_PATTERN.test(ABC_SHA256.toUpperCase())).toBe(false)
    expect(CONTENT_HASH_PATTERN.test(ABC_SHA256.slice(1))).toBe(false)
    expect(CONTENT_HASH_PATTERN.test('')).toBe(false)
  })
})

describe('stored-file Zod rules', () => {
  const schema = fieldToZodSchema({ name: 'file', label: 'File', type: 'file' } as never)
  const base = {
    fileId: 'f1',
    filename: 'a.pdf',
    originalFilename: 'a.pdf',
    mimeType: 'application/pdf',
    fileSize: 3,
    storageProvider: 'local',
    storagePath: 'media/a.pdf',
    processingStatus: 'complete',
  }

  it('accepts an absent, null or well-formed hash and validator', () => {
    expect(schema.safeParse(base).success).toBe(true)
    expect(schema.safeParse({ ...base, fileHash: null, storageValidator: null }).success).toBe(true)
    expect(
      schema.safeParse({
        ...base,
        fileHash: ABC_SHA256,
        storageValidator: { kind: 's3-etag', value: 'abc' },
      }).success
    ).toBe(true)
  })

  it('rejects an empty or malformed hash', () => {
    expect(schema.safeParse({ ...base, fileHash: '' }).success).toBe(false)
    expect(schema.safeParse({ ...base, fileHash: ABC_SHA256.toUpperCase() }).success).toBe(false)
    expect(schema.safeParse({ ...base, fileHash: ABC_SHA256.slice(2) }).success).toBe(false)
  })

  it('rejects an empty or oversized validator', () => {
    expect(schema.safeParse({ ...base, storageValidator: { kind: '', value: 'x' } }).success).toBe(
      false
    )
    expect(schema.safeParse({ ...base, storageValidator: { kind: 'k', value: '' } }).success).toBe(
      false
    )
    expect(
      schema.safeParse({ ...base, storageValidator: { kind: 'k'.repeat(33), value: 'x' } }).success
    ).toBe(false)
  })
})
