/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isSourceVerificationEvidence } from '../extraction/evidence.js'
import { ERR_STORAGE, ERR_STORAGE_PRECONDITION } from '../lib/errors.js'
import {
  probeVerifiedSource,
  readVerifiedSource,
  VERIFIED_SOURCE_SPOOL_PREFIX,
} from './verified-read.js'
import type { SourceVerificationEvidence } from '../@types/extraction-types.js'
import type {
  IStorageProvider,
  StorageDownloadOptions,
  StoredObjectRead,
} from '../@types/storage-types.js'

const BYTES = Buffer.from('the verified source bytes')
const HASH = createHash('sha256').update(BYTES).digest('hex')
const OTHER_BYTES = Buffer.from('different source bytes')
const OTHER_HASH = createHash('sha256').update(OTHER_BYTES).digest('hex')
const SAVED = { kind: 'test-etag', value: 'saved' }
const CURRENT = { kind: 'test-etag', value: 'current' }

type Step =
  | { reject: unknown }
  | { none: true }
  | { read: Partial<StoredObjectRead> & { bytes?: Buffer } }

const precondition = (reason: string) =>
  ERR_STORAGE_PRECONDITION({ message: `precondition: ${reason}`, details: { reason } })

/** A provider whose `download` follows a script, recording every call. */
function scripted(steps: Step[]) {
  const calls: Array<StorageDownloadOptions | undefined> = []
  const head = vi.fn()
  const provider: IStorageProvider = {
    providerName: 'test',
    upload: () => Promise.reject(new Error('never writes')),
    delete: () => Promise.reject(new Error('never writes')),
    getUrl: () => '',
    head,
    download: async (_path, options) => {
      calls.push(options)
      const step = steps[calls.length - 1]
      if (step === undefined) throw new Error(`unexpected read ${calls.length}`)
      if ('reject' in step) throw step.reject
      if ('none' in step) return null
      const { bytes, ...read } = step.read
      return {
        body: read.body ?? Readable.from(bytes === undefined ? [] : [bytes]),
        validator: read.validator ?? CURRENT,
        ...(read.size !== undefined && { size: read.size }),
      }
    },
  }
  return { provider, calls, head }
}

const source = (change?: object) => ({
  storagePath: 'files/a.pdf',
  storageProvider: 'test',
  fileHash: HASH,
  storageValidator: SAVED,
  ...change,
})

const readOf = (bytes: Buffer = BYTES): Step => ({ read: { bytes } })

describe('readVerifiedSource', () => {
  let spoolDirectory: string

  const spoolFiles = () =>
    readdirSync(spoolDirectory).filter((name) => name.startsWith(VERIFIED_SOURCE_SPOOL_PREFIX))

  beforeEach(() => {
    spoolDirectory = mkdtempSync(join(tmpdir(), 'byline-verified-read-test-'))
    vi.stubEnv('TMPDIR', spoolDirectory)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(spoolDirectory, { recursive: true, force: true })
  })

  describe('rule 1: no fileHash', () => {
    it.each([
      ['absent', undefined],
      ['empty', ''],
    ])('reports %s as missing-hash without any read', async (_label, fileHash) => {
      const { provider, calls } = scripted([])

      const result = await readVerifiedSource(provider, source({ fileHash }))

      expect(result).toEqual({
        status: 'identity-problem',
        problem: 'missing-hash',
        storagePath: 'files/a.pdf',
      })
      expect(calls).toEqual([])
    })
  })

  describe('rule 2: provider', () => {
    it('reports a value stored by another provider', async () => {
      const { provider, calls } = scripted([])

      const result = await readVerifiedSource(provider, source({ storageProvider: 'other' }))

      expect(result).toEqual({ status: 'unavailable', reason: 'provider-mismatch' })
      expect(calls).toEqual([])
    })

    it('reports a provider with no download', async () => {
      const { provider } = scripted([])
      delete provider.download

      expect(await readVerifiedSource(provider, source())).toEqual({
        status: 'unavailable',
        reason: 'download-unsupported',
      })
    })
  })

  describe('rule 3: the first read', () => {
    it('expects the saved validator', async () => {
      const { provider, calls } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source())

      expect(calls[0]?.expect).toEqual(SAVED)
      expect(result).toMatchObject({ status: 'verified' })
      if (result.status === 'verified') {
        expect(result.evidence.readBasis).toBe('expected')
        await result.body.dispose()
      }
    })

    it.each([
      ['no saved validator', { storageValidator: undefined }, undefined],
      ['knownChanged', {}, { knownChanged: true }],
    ])('reads without an expectation with %s', async (_label, change, options) => {
      const { provider, calls } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source(change), options)

      expect(calls[0]?.expect).toBeUndefined()
      expect(result).toMatchObject({
        status: 'verified',
        evidence: { readBasis: 'unconditional' },
      })
      expect(result.status === 'verified' && 'preconditionFallback' in result.evidence).toBe(false)
      if (result.status === 'verified') await result.body.dispose()
    })

    it('passes the signal to the read', async () => {
      const { provider, calls } = scripted([readOf()])
      const { signal } = new AbortController()

      const result = await readVerifiedSource(provider, source(), { signal })

      expect(calls[0]?.signal).toBe(signal)
      if (result.status === 'verified') await result.body.dispose()
    })
  })

  describe('rule 4: missing objects', () => {
    it('reports a missing precondition without a second read', async () => {
      const { provider, calls } = scripted([{ reject: precondition('missing') }])

      expect(await readVerifiedSource(provider, source())).toEqual({
        status: 'identity-problem',
        problem: 'missing-object',
        storagePath: 'files/a.pdf',
        expectedHash: HASH,
      })
      expect(calls).toHaveLength(1)
    })

    it('reports a null result', async () => {
      const { provider } = scripted([{ none: true }])

      expect(await readVerifiedSource(provider, source())).toMatchObject({
        status: 'identity-problem',
        problem: 'missing-object',
      })
    })

    it('never invents an observed hash', async () => {
      const { provider } = scripted([{ none: true }])

      const result = await readVerifiedSource(provider, source())

      expect(result).not.toHaveProperty('observedHash')
      expect(result).not.toHaveProperty('observedValidator')
    })
  })

  describe('rule 5: the single fallback read', () => {
    it.each(['changed', 'unsupported-kind', 'unestablishable'])(
      'falls back once on %s, keeping the reason',
      async (reason) => {
        const { provider, calls } = scripted([{ reject: precondition(reason) }, readOf()])

        const result = await readVerifiedSource(provider, source())

        expect(calls).toHaveLength(2)
        expect(calls[1]?.expect).toBeUndefined()
        expect(result).toMatchObject({
          status: 'verified',
          evidence: { readBasis: 'fallback', preconditionFallback: reason },
        })
        if (result.status === 'verified') await result.body.dispose()
      }
    )

    it('treats an unrecognised reason as unestablishable', async () => {
      const { provider } = scripted([{ reject: precondition('made-up') }, readOf()])

      const result = await readVerifiedSource(provider, source())

      expect(result).toMatchObject({
        status: 'verified',
        evidence: { preconditionFallback: 'unestablishable' },
      })
      if (result.status === 'verified') await result.body.dispose()
    })

    it('makes exactly two reads when both hit a precondition', async () => {
      const cause = precondition('changed')
      const { provider, calls } = scripted([{ reject: precondition('changed') }, { reject: cause }])

      expect(await readVerifiedSource(provider, source())).toEqual({
        status: 'unavailable',
        reason: 'read-failed',
        cause,
      })
      expect(calls).toHaveLength(2)
    })

    it('reports missing on the fallback with the fallback reason', async () => {
      const { provider } = scripted([
        { reject: precondition('changed') },
        { reject: precondition('missing') },
      ])

      expect(await readVerifiedSource(provider, source())).toMatchObject({
        status: 'identity-problem',
        problem: 'missing-object',
        preconditionFallback: 'changed',
      })
    })

    it('reports null on the fallback as missing-object', async () => {
      const { provider, calls } = scripted([{ reject: precondition('changed') }, { none: true }])

      expect(await readVerifiedSource(provider, source())).toMatchObject({
        status: 'identity-problem',
        problem: 'missing-object',
        preconditionFallback: 'changed',
      })
      expect(calls).toHaveLength(2)
    })

    it('reports any other fallback failure as read-failed', async () => {
      const cause = new Error('socket closed')
      const { provider } = scripted([{ reject: precondition('changed') }, { reject: cause }])

      expect(await readVerifiedSource(provider, source())).toEqual({
        status: 'unavailable',
        reason: 'read-failed',
        cause,
      })
    })
  })

  describe('rule 6: other failures', () => {
    it('reports read-failed with the original error, without a second read', async () => {
      const cause = ERR_STORAGE({ message: 'no validator', details: { reason: 'x' } })
      const { provider, calls } = scripted([{ reject: cause }])

      expect(await readVerifiedSource(provider, source())).toEqual({
        status: 'unavailable',
        reason: 'read-failed',
        cause,
      })
      expect(calls).toHaveLength(1)
    })

    it('reports aborted when the signal fired', async () => {
      const controller = new AbortController()
      const cause = new Error('aborted by the provider')
      const { provider } = scripted([])
      provider.download = async () => {
        controller.abort()
        throw cause
      }

      expect(await readVerifiedSource(provider, source(), { signal: controller.signal })).toEqual({
        status: 'unavailable',
        reason: 'aborted',
        cause,
      })
    })

    it('does not read when the signal has already fired', async () => {
      const controller = new AbortController()
      controller.abort()
      const { provider, calls } = scripted([])

      expect(
        await readVerifiedSource(provider, source(), { signal: controller.signal })
      ).toMatchObject({ status: 'unavailable', reason: 'aborted' })
      expect(calls).toEqual([])
    })
  })

  describe('rule 7: complete bodies only', () => {
    function failingBody(after: Buffer, error: Error): Readable {
      return Readable.from(
        (async function* () {
          yield after
          throw error
        })()
      )
    }

    it.each([
      ['in memory', undefined],
      ['while spooling', { memoryThreshold: 0 }],
    ])('reports a body that errors midway %s and leaves no spool', async (_label, options) => {
      const cause = new Error('connection reset')
      const { provider } = scripted([{ read: { body: failingBody(BYTES, cause) } }])

      const result = await readVerifiedSource(provider, source(), options)

      expect(result).toEqual({ status: 'unavailable', reason: 'read-failed', cause })
      expect(spoolFiles()).toEqual([])
    })

    it('reports a body shorter than its reported size as unavailable, not a mismatch', async () => {
      const { provider } = scripted([{ read: { bytes: BYTES, size: BYTES.length + 1 } }])

      const result = await readVerifiedSource(provider, source())

      expect(result).toMatchObject({ status: 'unavailable', reason: 'read-failed' })
      expect(result).not.toHaveProperty('observedHash')
    })

    it.each([
      ['in memory', undefined],
      ['while spooling', { memoryThreshold: 0 }],
    ])('reports an abort during the body %s and leaves no spool', async (_label, options) => {
      const controller = new AbortController()
      // One chunk, then it waits like a real transfer. A body that pushed from every
      // read() would keep the event loop busy, and the abort below might never run.
      let pushed = false
      const body = new Readable({
        read() {
          if (pushed) return
          pushed = true
          this.push(BYTES)
          setImmediate(() => controller.abort())
        },
      })
      const { provider } = scripted([{ read: { body } }])

      const result = await readVerifiedSource(provider, source(), {
        ...options,
        signal: controller.signal,
      })

      expect(result).toMatchObject({ status: 'unavailable', reason: 'aborted' })
      expect(body.destroyed).toBe(true)
      expect(spoolFiles()).toEqual([])
    })
  })

  describe('an abort that fires as the read completes', () => {
    it.each([
      ['in memory', undefined],
      ['while spooling', { memoryThreshold: 0 }],
    ])('reports an abort at the end of the body %s', async (_label, options) => {
      const controller = new AbortController()
      const body = Readable.from([BYTES])
      body.on('end', () => controller.abort())
      const { provider } = scripted([{ read: { body } }])

      const result = await readVerifiedSource(provider, source(), {
        ...options,
        signal: controller.signal,
      })

      expect(result).toMatchObject({ status: 'unavailable', reason: 'aborted' })
      expect(result).not.toHaveProperty('body')
      expect(spoolFiles()).toEqual([])
    })

    it.each([
      ['in memory', undefined],
      ['while spooling', { memoryThreshold: 0 }],
    ])('reports an abort during finalization %s', async (_label, options) => {
      const controller = new AbortController()
      // The validator is first read after the body ends, so this fires after the
      // end-of-body check and before the body is published.
      const { provider } = scripted([readOf()])
      const download = provider.download?.bind(provider)
      provider.download = async (path, downloadOptions) => {
        const result = await download?.(path, downloadOptions)
        return result == null
          ? null
          : Object.defineProperty(result, 'validator', {
              get() {
                controller.abort()
                return CURRENT
              },
            })
      }

      const result = await readVerifiedSource(provider, source(), {
        ...options,
        signal: controller.signal,
      })

      expect(result).toMatchObject({ status: 'unavailable', reason: 'aborted' })
      expect(result).not.toHaveProperty('body')
      expect(spoolFiles()).toEqual([])
    })
  })

  describe('a provider that reuses its chunk buffer', () => {
    const expectedBytes = Buffer.from('AB')
    const expectedHash = createHash('sha256').update(expectedBytes).digest('hex')

    /** Yields one buffer twice, changing it in between, as a pooling stream might. */
    function reusingBody(): Readable {
      const buffer = Buffer.from('A')
      return Readable.from(
        (async function* () {
          yield buffer
          await new Promise((resolve) => setImmediate(resolve))
          buffer[0] = 0x42
          yield buffer
        })()
      )
    }

    it.each([
      ['in memory', undefined],
      ['crossing the threshold', { memoryThreshold: 1 }],
      ['spooled from the start', { memoryThreshold: 0 }],
    ])('returns the bytes it hashed %s', async (_label, options) => {
      const { provider } = scripted([{ read: { body: reusingBody() } }])

      const result = await readVerifiedSource(provider, source({ fileHash: expectedHash }), options)

      if (result.status !== 'verified') throw new Error(`expected verified: ${result.status}`)
      const bytes = Buffer.from(await result.body.bytes())
      expect(bytes.equals(expectedBytes)).toBe(true)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.evidence.contentHash)

      const chunks: Uint8Array[] = []
      for await (const chunk of result.body.stream() as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
      }
      expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(
        result.evidence.contentHash
      )
      await result.body.dispose()
    })
  })

  describe('rule 8: a different hash', () => {
    it.each([
      ['in memory', undefined],
      ['while spooling', { memoryThreshold: 0 }],
    ])('reports %s what was observed and exposes nothing', async (_label, options) => {
      const { provider } = scripted([{ read: { bytes: OTHER_BYTES } }])

      const result = await readVerifiedSource(provider, source(), options)

      expect(result).toEqual({
        status: 'identity-problem',
        problem: 'hash-mismatch',
        storagePath: 'files/a.pdf',
        expectedHash: HASH,
        observedHash: OTHER_HASH,
        observedValidator: CURRENT,
      })
      expect(result).not.toHaveProperty('body')
      expect(spoolFiles()).toEqual([])
    })

    it('keeps the fallback reason', async () => {
      const { provider } = scripted([
        { reject: precondition('changed') },
        { read: { bytes: OTHER_BYTES } },
      ])

      expect(await readVerifiedSource(provider, source())).toMatchObject({
        problem: 'hash-mismatch',
        preconditionFallback: 'changed',
      })
    })
  })

  describe('rule 9: evidence', () => {
    it('binds the validator from this read, never the saved one', async () => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source())

      expect(result.status).toBe('verified')
      if (result.status !== 'verified') return
      expect(result.evidence.validator).toEqual(CURRENT)
      expect(result.evidence.expectedHash).toBe(HASH)
      expect(result.evidence.contentHash).toBe(HASH)
      expect(result.evidence.size).toBe(BYTES.length)
      expect(isSourceVerificationEvidence(result.evidence, { expectedHash: HASH })).toBe(true)
      await result.body.dispose()
    })

    it('reports a provider whose validator is unusable instead of writing bad evidence', async () => {
      const { provider } = scripted([
        { read: { bytes: BYTES, validator: { kind: '', value: '' } } },
      ])

      expect(await readVerifiedSource(provider, source())).toMatchObject({
        status: 'unavailable',
        reason: 'read-failed',
      })
      expect(spoolFiles()).toEqual([])
    })
  })

  describe('rule 10: read-only', () => {
    it('never writes to storage or changes the saved value', async () => {
      const value = source()
      const snapshot = structuredClone(value)
      const { provider } = scripted([{ reject: precondition('changed') }, readOf()])

      const result = await readVerifiedSource(provider, value)

      expect(value).toEqual(snapshot)
      if (result.status === 'verified') await result.body.dispose()
    })
  })

  describe('the verified body', () => {
    const collect = async (stream: ReadableStream<Uint8Array>) => {
      const chunks: Uint8Array[] = []
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk)
      return Buffer.concat(chunks)
    }

    it('stays in memory at or below the threshold', async () => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source(), {
        memoryThreshold: BYTES.length,
      })

      expect(result.status).toBe('verified')
      if (result.status !== 'verified') return
      expect(spoolFiles()).toEqual([])
      expect(result.body.size).toBe(BYTES.length)
      expect(Buffer.from(await result.body.bytes()).equals(BYTES)).toBe(true)
      await result.body.dispose()
    })

    it('spools above the threshold to a private file', async () => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source(), {
        memoryThreshold: BYTES.length - 1,
      })

      expect(result.status).toBe('verified')
      if (result.status !== 'verified') return
      const [spool] = spoolFiles()
      expect(spool).toBeDefined()
      expect(statSync(join(spoolDirectory, spool as string)).mode & 0o777).toBe(0o600)
      expect(Buffer.from(await result.body.bytes()).equals(BYTES)).toBe(true)
      await result.body.dispose()
    })

    it('crosses the threshold in the middle of a body', async () => {
      const body = Readable.from([BYTES.subarray(0, 5), BYTES.subarray(5, 10), BYTES.subarray(10)])
      const { provider } = scripted([{ read: { body } }])

      const result = await readVerifiedSource(provider, source(), { memoryThreshold: 7 })

      expect(result.status).toBe('verified')
      if (result.status !== 'verified') return
      expect(spoolFiles()).toHaveLength(1)
      expect((await collect(result.body.stream())).equals(BYTES)).toBe(true)
      await result.body.dispose()
    })

    it.each([
      ['memory', undefined],
      ['a spool', { memoryThreshold: 0 }],
    ])('opens more than one stream over %s', async (_label, options) => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source(), options)

      expect(result.status).toBe('verified')
      if (result.status !== 'verified') return
      expect((await collect(result.body.stream())).equals(BYTES)).toBe(true)
      expect((await collect(result.body.stream())).equals(BYTES)).toBe(true)
      await result.body.dispose()
    })

    it('gives a caller a copy, so verified bytes cannot be changed in place', async () => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source())

      if (result.status !== 'verified') throw new Error('expected verified')
      const first = await result.body.bytes()
      first.fill(0)
      expect(Buffer.from(await result.body.bytes()).equals(BYTES)).toBe(true)
      await result.body.dispose()
    })

    it('gives each stream a copy, so a provider cannot change verified bytes in place', async () => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source())

      if (result.status !== 'verified') throw new Error('expected verified')
      const reader = result.body.stream().getReader()
      const { value } = await reader.read()
      value?.fill(0)
      expect((await collect(result.body.stream())).equals(BYTES)).toBe(true)
      await result.body.dispose()
    })

    it('verifies an empty object', async () => {
      const empty = Buffer.alloc(0)
      const emptyHash = createHash('sha256').update(empty).digest('hex')
      const { provider } = scripted([{ read: { body: Readable.from([]) } }])

      const result = await readVerifiedSource(provider, source({ fileHash: emptyHash }))

      expect(result.status).toBe('verified')
      if (result.status !== 'verified') return
      expect(result.body.size).toBe(0)
      expect((await collect(result.body.stream())).length).toBe(0)
      await result.body.dispose()
    })

    it('removes the spool on dispose, and dispose is idempotent', async () => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source(), { memoryThreshold: 0 })

      if (result.status !== 'verified') throw new Error('expected verified')
      expect(spoolFiles()).toHaveLength(1)
      await result.body.dispose()
      await result.body.dispose()
      expect(spoolFiles()).toEqual([])
    })

    it.each([
      ['memory', undefined],
      ['a spool', { memoryThreshold: 0 }],
    ])('refuses to read %s after dispose', async (_label, options) => {
      const { provider } = scripted([readOf()])

      const result = await readVerifiedSource(provider, source(), options)

      if (result.status !== 'verified') throw new Error('expected verified')
      await result.body.dispose()
      expect(() => result.body.stream()).toThrow(/disposed/)
      await expect(result.body.bytes()).rejects.toThrow(/disposed/)
    })

    it.each([-1, 1.5, Number.NaN])('rejects a memoryThreshold of %s', async (memoryThreshold) => {
      const { provider, calls } = scripted([])

      await expect(readVerifiedSource(provider, source(), { memoryThreshold })).rejects.toThrow(
        TypeError
      )
      expect(calls).toEqual([])
    })
  })
})

describe('probeVerifiedSource', () => {
  const evidence: SourceVerificationEvidence = {
    expectedHash: HASH,
    contentHash: HASH,
    validator: CURRENT,
    verifiedAt: '2026-11-04T00:00:00.000Z',
  }

  it('reports unchanged against the evidence validator', async () => {
    const { provider, head } = scripted([])
    head.mockResolvedValue({ validator: CURRENT })

    expect(await probeVerifiedSource(provider, 'a', evidence)).toEqual({
      status: 'unchanged',
      validator: CURRENT,
    })
  })

  it('reports a different value as changed', async () => {
    const { provider, head } = scripted([])
    const other = { kind: 'test-etag', value: 'other' }
    head.mockResolvedValue({ validator: other })

    expect(await probeVerifiedSource(provider, 'a', evidence)).toEqual({
      status: 'changed',
      validator: other,
    })
  })

  it('reports a different kind as changed', async () => {
    const { provider, head } = scripted([])
    const other = { kind: 'other-kind', value: 'current' }
    head.mockResolvedValue({ validator: other })

    expect(await probeVerifiedSource(provider, 'a', evidence)).toEqual({
      status: 'changed',
      validator: other,
    })
  })

  it('reports a deleted object', async () => {
    const { provider, head } = scripted([])
    head.mockResolvedValue(null)

    expect(await probeVerifiedSource(provider, 'a', evidence)).toEqual({
      status: 'missing-object',
    })
  })

  it('reports a failing probe as unavailable, with its cause', async () => {
    const { provider, head } = scripted([])
    const cause = new Error('head failed')
    head.mockRejectedValue(cause)

    expect(await probeVerifiedSource(provider, 'a', evidence)).toEqual({
      status: 'unavailable',
      cause,
    })
  })

  it('reports a provider without head as unprobed', async () => {
    const { provider } = scripted([])
    delete provider.head

    expect(await probeVerifiedSource(provider, 'a', evidence)).toEqual({
      status: 'unprobed',
      reason: 'head-unsupported',
    })
  })

  it('does not call head without evidence, so a copied value cannot stand in', async () => {
    const { provider, head } = scripted([])

    expect(await probeVerifiedSource(provider, 'a', null)).toEqual({
      status: 'unprobed',
      reason: 'no-evidence',
    })
    expect(head).not.toHaveBeenCalled()
  })

  it('treats malformed evidence as no evidence', async () => {
    const { provider, head } = scripted([])

    expect(
      await probeVerifiedSource(provider, 'a', {
        expectedHash: HASH,
      } as unknown as SourceVerificationEvidence)
    ).toEqual({ status: 'unprobed', reason: 'no-evidence' })
    expect(head).not.toHaveBeenCalled()
  })
})
