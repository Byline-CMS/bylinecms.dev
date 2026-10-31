/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomBytes } from 'node:crypto'

import type { IStorageProvider, StorageValidator } from '@byline/core'
import { ErrorCodes, isSameStorageValidator } from '@byline/core'
import { hashStream, uploadWithContentHash } from '@byline/core/stored-files'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Replaces the object at `storagePath` with `bytes` through some write path
 * of the provider under test. The suite always exercises same-path upload
 * (`targetStoragePath`) and, when the provider has `move`, a move over the
 * path. Providers add their own paths here — for example `storage-local`'s
 * cross-filesystem move fallback.
 */
interface StorageReplacer {
  name: string
  replace(provider: IStorageProvider, storagePath: string, bytes: Buffer): Promise<void>
}

/** Provider-owned hooks for running the shared storage suites. */
export interface StorageConformanceHooks {
  /** Shown in suite names, e.g. `'storage-local'`. */
  name: string
  /** A provider over a fresh, empty store. */
  createProvider(): IStorageProvider | Promise<IStorageProvider>
  /** Validator kinds the provider issues, e.g. `['local-stat']`. */
  validatorKinds: string[]
  /** Additional same-path replacement paths for the overlapping-reader case. */
  extraReplacers?: StorageReplacer[]
  teardown?(): void | Promise<void>
}

const OCTET = 'application/octet-stream'

/** Distinct bytes per call; large enough that providers stream rather than buffer. */
function payload(label: string, size = 256 * 1024): Buffer {
  const head = Buffer.from(`${label}:`)
  return Buffer.concat([head, randomBytes(size - head.length)])
}

function uniquePath(label: string): string {
  return `conformance/${label}-${randomBytes(6).toString('hex')}.bin`
}

async function put(provider: IStorageProvider, storagePath: string, bytes: Buffer) {
  return uploadWithContentHash(provider, bytes, {
    filename: storagePath.split('/').pop() ?? 'object.bin',
    mimeType: OCTET,
    size: bytes.length,
    targetStoragePath: storagePath,
  })
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

function expectPrecondition(error: unknown, reason: string) {
  expect(error).toMatchObject({
    code: ErrorCodes.STORAGE_PRECONDITION,
    details: expect.objectContaining({ reason }),
  })
}

/** Removes optional read capabilities to exercise degraded providers. */
function withoutCapabilities(
  provider: IStorageProvider,
  remove: Array<'head' | 'download'>
): IStorageProvider {
  const wrapped: IStorageProvider = {
    providerName: provider.providerName,
    upload: provider.upload.bind(provider),
    delete: provider.delete.bind(provider),
    getUrl: provider.getUrl.bind(provider),
  }
  if (provider.move) wrapped.move = provider.move.bind(provider)
  if (provider.exists) wrapped.exists = provider.exists.bind(provider)
  if (provider.download && !remove.includes('download')) {
    wrapped.download = provider.download.bind(provider)
  }
  if (provider.head && !remove.includes('head')) wrapped.head = provider.head.bind(provider)
  return wrapped
}

/**
 * Registers the stored-file identity conformance cases (spec 2026-10-31 §5)
 * against one provider. The provider must implement `download` and `head`.
 */
export function runStorageProviderConformanceSuite(hooks: StorageConformanceHooks): void {
  describe(`${hooks.name} storage conformance`, () => {
    let provider: IStorageProvider
    const unsupportedKind = 'conformance-unsupported-kind'

    beforeAll(async () => {
      provider = await hooks.createProvider()
      expect(provider.download, 'provider must implement download').toBeTypeOf('function')
      expect(provider.head, 'provider must implement head').toBeTypeOf('function')
      expect(hooks.validatorKinds).not.toContain(unsupportedKind)
    })

    afterAll(async () => {
      await hooks.teardown?.()
    })

    // 1. Upload returns a validator of a declared kind, equal to head's.
    it('returns a validator from upload that head reports unchanged', async () => {
      const storagePath = uniquePath('upload-validator')
      const { location } = await put(provider, storagePath, payload('one'))

      expect(location.storageValidator).toBeDefined()
      const validator = location.storageValidator as StorageValidator
      expect(hooks.validatorKinds).toContain(validator.kind)

      const head = await provider.head?.(storagePath)
      expect(head?.validator).toEqual(validator)
    })

    // 2. Same-path changed bytes: new validator and new content hash.
    it('gives changed bytes at the same path a new validator and a new hash', async () => {
      const storagePath = uniquePath('changed')
      const first = await put(provider, storagePath, payload('first'))
      const second = await put(provider, storagePath, payload('second'))

      expect(second.fileHash).not.toBe(first.fileHash)
      expect(
        isSameStorageValidator(
          first.location.storageValidator as StorageValidator,
          second.location.storageValidator as StorageValidator
        )
      ).toBe(false)
    })

    // 3. Same-path unchanged bytes: same content hash (validator may differ).
    it('gives unchanged bytes at the same path the same hash', async () => {
      const storagePath = uniquePath('unchanged')
      const bytes = payload('same')
      const first = await put(provider, storagePath, bytes)
      const second = await put(provider, storagePath, Buffer.from(bytes))

      expect(second.fileHash).toBe(first.fileHash)
    })

    // 4. download returns the exact bytes with head's validator.
    it('downloads the exact bytes bound to the current validator', async () => {
      const storagePath = uniquePath('download')
      const bytes = payload('download')
      const { fileHash } = await put(provider, storagePath, bytes)

      const head = await provider.head?.(storagePath)
      const read = await provider.download?.(storagePath)
      expect(read).not.toBeNull()
      if (!read) return
      expect(read.validator).toEqual(head?.validator)
      const body = await readAll(read.body)
      expect(body.equals(bytes)).toBe(true)

      // Expecting the current validator streams the same bytes.
      const expected = await provider.download?.(storagePath, { expect: read.validator })
      if (!expected) throw new Error('expected a bound read')
      expect((await hashStream(expected.body)).fileHash).toBe(fileHash)
    })

    // 5. A stale expectation fails before any byte is exposed.
    it('rejects a stale expectation with reason "changed"', async () => {
      const storagePath = uniquePath('stale')
      const { location } = await put(provider, storagePath, payload('v1'))
      await put(provider, storagePath, payload('v2'))

      const error = await provider
        .download?.(storagePath, { expect: location.storageValidator as StorageValidator })
        .then(
          () => null,
          (err: unknown) => err
        )
      expectPrecondition(error, 'changed')
    })

    // 6. Missing objects resolve null without an expectation.
    it('resolves null from download and head for a missing object', async () => {
      const storagePath = uniquePath('missing')
      await expect(provider.download?.(storagePath)).resolves.toBeNull()
      await expect(provider.head?.(storagePath)).resolves.toBeNull()
    })

    // 7. Degraded providers (spec §4.9).
    it('still records a content hash when head and download are absent', async () => {
      const bare = withoutCapabilities(provider, ['head', 'download'])
      expect(bare.head).toBeUndefined()
      expect(bare.download).toBeUndefined()

      const bytes = payload('bare')
      const storagePath = uniquePath('bare')
      const { fileHash } = await put(bare, storagePath, bytes)

      // The hash is the hash of the stored bytes, checked through the full provider.
      const read = await provider.download?.(storagePath)
      if (!read) throw new Error('expected a bound read')
      expect((await hashStream(read.body)).fileHash).toBe(fileHash)
    })

    it('can check freshness through download with expect when head is absent', async () => {
      const noHead = withoutCapabilities(provider, ['head'])
      const storagePath = uniquePath('no-head')
      const { location } = await put(noHead, storagePath, payload('fresh'))
      const validator = location.storageValidator as StorageValidator

      const fresh = await noHead.download?.(storagePath, { expect: validator })
      expect(fresh).not.toBeNull()
      await readAll((fresh as { body: NodeJS.ReadableStream }).body)

      await put(noHead, storagePath, payload('replaced'))
      const error = await noHead.download?.(storagePath, { expect: validator }).then(
        () => null,
        (err: unknown) => err
      )
      expectPrecondition(error, 'changed')
    })

    // 8. Unsupported kinds and missing objects under an expectation.
    it('rejects an unsupported expectation kind before reading', async () => {
      const storagePath = uniquePath('unsupported')
      await put(provider, storagePath, payload('x'))
      const error = await provider
        .download?.(storagePath, { expect: { kind: unsupportedKind, value: 'v' } })
        .then(
          () => null,
          (err: unknown) => err
        )
      expectPrecondition(error, 'unsupported-kind')

      // Checked before any request: also for a path that does not exist.
      const missingError = await provider
        .download?.(uniquePath('unsupported-missing'), {
          expect: { kind: unsupportedKind, value: 'v' },
        })
        .then(
          () => null,
          (err: unknown) => err
        )
      expectPrecondition(missingError, 'unsupported-kind')
    })

    it('rejects an expectation on a missing object with reason "missing"', async () => {
      const storagePath = uniquePath('expect-missing')
      const { location } = await put(provider, storagePath, payload('gone'))
      await provider.delete(storagePath)

      const error = await provider
        .download?.(storagePath, { expect: location.storageValidator as StorageValidator })
        .then(
          () => null,
          (err: unknown) => err
        )
      expectPrecondition(error, 'missing')
    })

    // 9. A reader opened before a same-path replacement keeps its version.
    const replacers: StorageReplacer[] = [
      {
        name: 'upload',
        replace: async (p, storagePath, bytes) => {
          await put(p, storagePath, bytes)
        },
      },
      {
        name: 'move',
        replace: async (p, storagePath, bytes) => {
          if (!p.move) return
          const staging = uniquePath('staging')
          await put(p, staging, bytes)
          await p.move(staging, storagePath)
        },
      },
      ...(hooks.extraReplacers ?? []),
    ]

    for (const replacer of replacers) {
      it(`keeps an open reader on its version when replaced by ${replacer.name}`, async () => {
        const storagePath = uniquePath(`overlap-${replacer.name}`)
        const original = payload('original', 1024 * 1024)
        const { location } = await put(provider, storagePath, original)

        const read = await provider.download?.(storagePath)
        if (!read) throw new Error('expected a bound read')
        expect(read.validator).toEqual(location.storageValidator)

        const replacement = payload('replacement', 1024 * 1024)
        await replacer.replace(provider, storagePath, replacement)

        const body = await readAll(read.body)
        expect(body.equals(original)).toBe(true)

        const after = await provider.head?.(storagePath)
        if (replacer.name === 'move' && !provider.move) return
        expect(after?.validator).not.toEqual(read.validator)
        const current = await provider.download?.(storagePath)
        if (!current) throw new Error('expected a bound read')
        expect((await readAll(current.body)).equals(replacement)).toBe(true)
      })
    }
  })
}
