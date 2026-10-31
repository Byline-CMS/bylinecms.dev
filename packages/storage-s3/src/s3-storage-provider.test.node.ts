/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'

import {
  CopyObjectCommand,
  CreateBucketCommand,
  type GetObjectCommand,
  HeadObjectCommand,
  PutBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { ErrorCodes } from '@byline/core'
import { uploadWithContentHash } from '@byline/core/stored-files'
import { runStorageProviderConformanceSuite } from '@byline/storage-conformance'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  S3_ETAG_KIND,
  S3_VERSION_KIND,
  s3StorageProvider,
  selectS3Validator,
} from './s3-storage-provider.js'

// ---------------------------------------------------------------------------
// Validator selection
// ---------------------------------------------------------------------------

describe('selectS3Validator', () => {
  it('prefers a usable version id', () => {
    expect(selectS3Validator({ VersionId: 'v1', ETag: '"e1"' })).toEqual({
      kind: S3_VERSION_KIND,
      value: 'v1',
    })
  })

  it('never treats the literal "null" version id as a validator', () => {
    expect(selectS3Validator({ VersionId: 'null', ETag: '"e1"' })).toEqual({
      kind: S3_ETAG_KIND,
      value: 'e1',
    })
  })

  it('falls back to the strong ETag without its quotes, including multipart ETags', () => {
    expect(selectS3Validator({ ETag: '"abc-3"' })).toEqual({ kind: S3_ETAG_KIND, value: 'abc-3' })
  })

  it('never uses a weak ETag, but still prefers a usable version id', () => {
    expect(selectS3Validator({ ETag: 'W/"weak"' })).toBeUndefined()
    expect(selectS3Validator({ VersionId: 'null', ETag: 'W/"weak"' })).toBeUndefined()
    expect(selectS3Validator({ VersionId: 'v1', ETag: 'W/"weak"' })).toEqual({
      kind: S3_VERSION_KIND,
      value: 'v1',
    })
  })

  it('returns no validator when neither token is usable', () => {
    expect(selectS3Validator({})).toBeUndefined()
    expect(selectS3Validator({ VersionId: 'null' })).toBeUndefined()
    expect(selectS3Validator({ VersionId: 'null', ETag: '""' })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Mocked client: download / head / move behaviour
// ---------------------------------------------------------------------------

function trackedBody(bytes = Buffer.from('bytes')) {
  const body = Readable.from([bytes])
  const destroy = vi.spyOn(body, 'destroy')
  return { body, destroy }
}

function s3Error(name: string, status: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })
}

describe('storage-s3 with a mocked client', () => {
  const provider = s3StorageProvider({
    bucket: 'unit-bucket',
    region: 'us-east-1',
    accessKeyId: 'test',
    secretAccessKey: 'test',
  })
  let send: ReturnType<typeof vi.spyOn>

  function respond(handler: (command: unknown) => unknown) {
    send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      const result = handler(command)
      if (result instanceof Error) throw result
      return result as never
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds the body to a "null"-version response through its ETag', async () => {
    const { body } = trackedBody()
    respond(() => ({ Body: body, VersionId: 'null', ETag: '"e1"', ContentLength: 5 }))

    const read = await provider.download?.('k')
    expect(read?.validator).toEqual({ kind: S3_ETAG_KIND, value: 'e1' })
    expect(read?.size).toBe(5)
  })

  it('fails without exposing the body when no usable validator exists', async () => {
    const { body, destroy } = trackedBody()
    respond(() => ({ Body: body, VersionId: 'null' }))

    await expect(provider.download?.('k')).rejects.toMatchObject({
      code: ErrorCodes.STORAGE,
      details: expect.objectContaining({ reason: 'validator-unavailable' }),
    })
    expect(destroy).toHaveBeenCalled()
  })

  it('sends If-Match for an ETag expectation and still checks the response ETag', async () => {
    const { body, destroy } = trackedBody()
    let ifMatch: string | undefined
    respond((command) => {
      ifMatch = (command as GetObjectCommand).input.IfMatch
      // A store that ignores If-Match returns the current object anyway.
      return { Body: body, ETag: '"other"' }
    })

    await expect(
      provider.download?.('k', { expect: { kind: S3_ETAG_KIND, value: 'expected' } })
    ).rejects.toMatchObject({
      code: ErrorCodes.STORAGE_PRECONDITION,
      details: expect.objectContaining({ reason: 'changed' }),
    })
    expect(ifMatch).toBe('"expected"')
    expect(destroy).toHaveBeenCalled()
  })

  it('fails without exposing the body when the only ETag is weak', async () => {
    const { body, destroy } = trackedBody()
    respond(() => ({ Body: body, ETag: 'W/"same"' }))

    await expect(provider.download?.('k')).rejects.toMatchObject({
      code: ErrorCodes.STORAGE,
      details: expect.objectContaining({ reason: 'validator-unavailable' }),
    })
    expect(destroy).toHaveBeenCalled()
  })

  it('cannot establish an ETag expectation against a weak response ETag', async () => {
    // An endpoint that ignores If-Match returns W/"same" for changed bytes.
    const { body, destroy } = trackedBody()
    respond(() => ({ Body: body, ETag: 'W/"same"' }))

    await expect(
      provider.download?.('k', { expect: { kind: S3_ETAG_KIND, value: 'same' } })
    ).rejects.toMatchObject({
      code: ErrorCodes.STORAGE_PRECONDITION,
      details: expect.objectContaining({ reason: 'unestablishable' }),
    })
    expect(destroy).toHaveBeenCalled()
  })

  it('cannot establish an ETag expectation when a versioned response carries a weak ETag', async () => {
    const { body, destroy } = trackedBody()
    respond(() => ({ Body: body, ETag: 'W/"same"', VersionId: 'v3' }))

    await expect(
      provider.download?.('k', { expect: { kind: S3_ETAG_KIND, value: 'same' } })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'unestablishable' }) })
    expect(destroy).toHaveBeenCalled()
  })

  it('binds a weak-ETag response through its usable version id', async () => {
    const { body } = trackedBody()
    respond(() => ({ Body: body, ETag: 'W/"same"', VersionId: 'v3' }))

    const read = await provider.download?.('k')
    expect(read?.validator).toEqual({ kind: S3_VERSION_KIND, value: 'v3' })
  })

  it('treats a weak ETag on head as unusable', async () => {
    respond(() => ({ ETag: 'W/"h"' }))
    await expect(provider.head?.('k')).rejects.toMatchObject({
      details: expect.objectContaining({ reason: 'validator-unavailable' }),
    })
  })

  it('maps a 412 response to reason "changed"', async () => {
    respond(() => s3Error('PreconditionFailed', 412))

    await expect(
      provider.download?.('k', { expect: { kind: S3_ETAG_KIND, value: 'e1' } })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'changed' }) })
  })

  it('matches an ETag expectation after versioning is enabled and returns the version validator', async () => {
    const { body } = trackedBody()
    respond(() => ({ Body: body, ETag: '"e1"', VersionId: 'v9' }))

    const read = await provider.download?.('k', { expect: { kind: S3_ETAG_KIND, value: 'e1' } })
    expect(read?.validator).toEqual({ kind: S3_VERSION_KIND, value: 'v9' })
  })

  it('rejects a version expectation as unestablishable once versioning is suspended', async () => {
    const { body, destroy } = trackedBody()
    respond(() => ({ Body: body, ETag: '"e2"', VersionId: 'null' }))

    await expect(
      provider.download?.('k', { expect: { kind: S3_VERSION_KIND, value: 'v1' } })
    ).rejects.toMatchObject({
      code: ErrorCodes.STORAGE_PRECONDITION,
      details: expect.objectContaining({ reason: 'unestablishable' }),
    })
    expect(destroy).toHaveBeenCalled()
  })

  it('rejects a different version with reason "changed"', async () => {
    const { body, destroy } = trackedBody()
    respond(() => ({ Body: body, ETag: '"e2"', VersionId: 'v2' }))

    await expect(
      provider.download?.('k', { expect: { kind: S3_VERSION_KIND, value: 'v1' } })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'changed' }) })
    expect(destroy).toHaveBeenCalled()
  })

  it('rejects an unsupported kind without sending a request', async () => {
    respond(() => {
      throw new Error('should not be called')
    })

    await expect(
      provider.download?.('k', { expect: { kind: 'local-stat', value: 'x' } })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'unsupported-kind' }) })
    expect(send).not.toHaveBeenCalled()
  })

  it('resolves null for a missing object, or "missing" under an expectation', async () => {
    respond(() => s3Error('NoSuchKey', 404))

    await expect(provider.download?.('k')).resolves.toBeNull()
    await expect(
      provider.download?.('k', { expect: { kind: S3_ETAG_KIND, value: 'e1' } })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'missing' }) })
  })

  it('applies the same selection rule to head', async () => {
    respond((command) =>
      command instanceof HeadObjectCommand
        ? { VersionId: 'null', ETag: '"h1"', ContentLength: 9 }
        : {}
    )
    await expect(provider.head?.('k')).resolves.toEqual({
      validator: { kind: S3_ETAG_KIND, value: 'h1' },
      size: 9,
    })

    vi.restoreAllMocks()
    respond(() => ({ VersionId: 'null' }))
    await expect(provider.head?.('k')).rejects.toMatchObject({
      details: expect.objectContaining({ reason: 'validator-unavailable' }),
    })

    vi.restoreAllMocks()
    respond(() => s3Error('NotFound', 404))
    await expect(provider.head?.('k')).resolves.toBeNull()
  })

  it('applies the same selection rule to the copy in move', async () => {
    respond((command) =>
      command instanceof CopyObjectCommand
        ? { VersionId: 'null', CopyObjectResult: { ETag: '"c1"' } }
        : {}
    )
    const moved = await provider.move?.('a', 'b')
    expect(moved?.storageValidator).toEqual({ kind: S3_ETAG_KIND, value: 'c1' })
  })
})

// ---------------------------------------------------------------------------
// Live conformance against an S3-compatible endpoint (MinIO in CI)
// ---------------------------------------------------------------------------

const endpoint = process.env.BYLINE_S3_TEST_ENDPOINT
const live = endpoint
  ? {
      endpoint,
      region: process.env.BYLINE_S3_TEST_REGION ?? 'us-east-1',
      accessKeyId: process.env.BYLINE_S3_TEST_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.BYLINE_S3_TEST_SECRET_KEY ?? 'minioadmin',
    }
  : undefined

if (!live) {
  describe('storage-s3 live conformance', () => {
    it.skip('set BYLINE_S3_TEST_ENDPOINT to run against an S3-compatible server', () => {})
  })
} else {
  const admin = new S3Client({
    endpoint: live.endpoint,
    region: live.region,
    forcePathStyle: true,
    credentials: { accessKeyId: live.accessKeyId, secretAccessKey: live.secretAccessKey },
  })

  async function createBucket(versioning: 'Enabled' | 'none'): Promise<string> {
    const bucket = `byline-conformance-${randomBytes(5).toString('hex')}`
    await admin.send(new CreateBucketCommand({ Bucket: bucket }))
    if (versioning === 'Enabled') {
      await admin.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        })
      )
    }
    return bucket
  }

  const providerFor = (bucket: string) =>
    s3StorageProvider({
      bucket,
      region: live.region,
      endpoint: live.endpoint,
      forcePathStyle: true,
      accessKeyId: live.accessKeyId,
      secretAccessKey: live.secretAccessKey,
    })

  let unversioned = ''
  let versioned = ''
  beforeAll(async () => {
    unversioned = await createBucket('none')
    versioned = await createBucket('Enabled')
  })

  runStorageProviderConformanceSuite({
    name: 'storage-s3 (unversioned bucket)',
    createProvider: () => providerFor(unversioned),
    validatorKinds: [S3_ETAG_KIND],
  })

  runStorageProviderConformanceSuite({
    name: 'storage-s3 (versioned bucket)',
    createProvider: () => providerFor(versioned),
    validatorKinds: [S3_VERSION_KIND],
  })

  describe('storage-s3 suspended versioning', () => {
    it('never pairs changed bytes with a reused "null" version id', async () => {
      const bucket = await createBucket('Enabled')
      const provider = providerFor(bucket)
      const key = 'suspended/object.bin'
      const put = (bytes: Buffer) =>
        uploadWithContentHash(provider, bytes, {
          filename: 'object.bin',
          mimeType: 'application/octet-stream',
          size: bytes.length,
          targetStoragePath: key,
        })

      const versionedWrite = await put(randomBytes(1024))
      expect(versionedWrite.location.storageValidator?.kind).toBe(S3_VERSION_KIND)

      await admin.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Suspended' },
        })
      )

      const first = await put(randomBytes(1024))
      const second = await put(randomBytes(1024))
      expect(first.location.storageValidator?.kind).toBe(S3_ETAG_KIND)
      expect(second.location.storageValidator).not.toEqual(first.location.storageValidator)
      expect(second.fileHash).not.toBe(first.fileHash)

      await expect(
        provider.download?.(key, {
          expect: versionedWrite.location.storageValidator as { kind: string; value: string },
        })
      ).rejects.toMatchObject({
        code: ErrorCodes.STORAGE_PRECONDITION,
        details: expect.objectContaining({ reason: 'unestablishable' }),
      })
    })
  })
}
