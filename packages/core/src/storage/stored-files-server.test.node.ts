/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { ErrorCodes } from '../lib/errors.js'
import { hashStream, uploadWithContentHash } from './stored-files-server.js'
import type { IStorageProvider, UploadFileOptions } from '../@types/storage-types.js'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A source that never ends on its own. */
function endless(): Readable {
  return new Readable({
    read() {
      this.push(Buffer.alloc(1024, 1))
    },
  })
}

/** A provider that drains the stream (or takes the buffer) and records what it stored. */
function drainingProvider(options?: { consume?: 'all' | 'none' }) {
  const stored = new Map<string, Buffer>()
  const upload = vi.fn(async (input: NodeJS.ReadableStream | Buffer, opts: UploadFileOptions) => {
    const storagePath = opts.targetStoragePath ?? 'media/generated-abc123.bin'
    if (Buffer.isBuffer(input)) {
      stored.set(storagePath, input)
    } else if (options?.consume !== 'none') {
      const chunks: Buffer[] = []
      for await (const chunk of input as AsyncIterable<Buffer>) chunks.push(chunk)
      stored.set(storagePath, Buffer.concat(chunks))
    } else {
      stored.set(storagePath, Buffer.alloc(0))
    }
    return {
      storageProvider: 'test',
      storagePath,
      storageUrl: null,
      storageValidator: { kind: 'test', value: '1' },
    }
  })
  const del = vi.fn(async (storagePath: string) => {
    stored.delete(storagePath)
  })
  const storage: IStorageProvider = {
    providerName: 'test',
    upload,
    delete: del,
    getUrl: (p) => `/files/${p}`,
  }
  return { storage, upload, del, stored }
}

const opts = (size: number, extra?: Partial<UploadFileOptions>): UploadFileOptions => ({
  filename: 'a.bin',
  mimeType: 'application/octet-stream',
  size,
  ...extra,
})

describe('hashStream', () => {
  it('hashes a stream to its end and counts bytes', async () => {
    const bytes = Buffer.from('hello world')
    await expect(
      hashStream(Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]))
    ).resolves.toEqual({
      fileHash: sha(bytes),
      size: bytes.length,
    })
  })

  it('rejects an already-aborted signal and destroys the stream', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const stream = Readable.from([Buffer.from('x')])

    await expect(hashStream(stream, { signal: controller.signal })).rejects.toThrow('stop')
    expect(stream.destroyed).toBe(true)
  })

  it('destroys the stream when aborted mid-read', async () => {
    const controller = new AbortController()
    let chunks = 0
    // Aborts from inside the source after a few chunks, so the test does not
    // depend on a timer firing between synchronous pushes.
    const stream = new Readable({
      read() {
        chunks += 1
        if (chunks === 4) controller.abort(new Error('later'))
        this.push(Buffer.alloc(1024, 1))
      },
    })

    await expect(hashStream(stream, { signal: controller.signal })).rejects.toThrow()
    expect(stream.destroyed).toBe(true)
  })
})

describe('uploadWithContentHash', () => {
  it('hashes a buffer and returns the provider location', async () => {
    const { storage, stored } = drainingProvider()
    const bytes = Buffer.from('buffered bytes')

    const result = await uploadWithContentHash(storage, bytes, opts(bytes.length))

    expect(result.fileHash).toBe(sha(bytes))
    expect(result.location.storageValidator).toEqual({ kind: 'test', value: '1' })
    expect(stored.get(result.location.storagePath)).toEqual(bytes)
  })

  it('rejects a buffer of the wrong length before calling the provider', async () => {
    const { storage, upload } = drainingProvider()

    await expect(uploadWithContentHash(storage, Buffer.from('abc'), opts(4))).rejects.toMatchObject(
      {
        code: ErrorCodes.VALIDATION,
        details: expect.objectContaining({ reason: 'size-mismatch' }),
      }
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it('hashes a stream in the same pass the provider consumes it', async () => {
    const { storage, stored } = drainingProvider()
    const parts = [Buffer.from('chunk-one;'), Buffer.from('chunk-two;'), Buffer.from('three')]
    const whole = Buffer.concat(parts)

    const result = await uploadWithContentHash(storage, Readable.from(parts), opts(whole.length))

    expect(result.fileHash).toBe(sha(whole))
    expect(stored.get(result.location.storagePath)).toEqual(whole)
  })

  it('fails a short stream and deletes the provider-generated object', async () => {
    const { storage, del, stored } = drainingProvider()

    await expect(
      uploadWithContentHash(storage, Readable.from([Buffer.from('abc')]), opts(10))
    ).rejects.toMatchObject({
      code: ErrorCodes.STORAGE,
      details: expect.objectContaining({
        reason: 'size-mismatch',
        actualSize: 3,
        declaredSize: 10,
        objectDeleted: true,
        replacementUndone: false,
      }),
    })
    expect(del).toHaveBeenCalledWith('media/generated-abc123.bin')
    expect(stored.size).toBe(0)
  })

  it('fails a long stream', async () => {
    const { storage } = drainingProvider()

    await expect(
      uploadWithContentHash(storage, Readable.from([Buffer.from('abcdef')]), opts(3))
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'size-mismatch' }) })
  })

  it('does not delete a verbatim targetStoragePath write it cannot undo', async () => {
    const { storage, del } = drainingProvider()

    await expect(
      uploadWithContentHash(
        storage,
        Readable.from([Buffer.from('abc')]),
        opts(10, { targetStoragePath: 'media/fixed.bin' })
      )
    ).rejects.toMatchObject({
      details: expect.objectContaining({ objectDeleted: false, replacementUndone: false }),
    })
    expect(del).not.toHaveBeenCalled()
  })

  it('fails when the provider resolves without consuming the stream', async () => {
    const { storage, del } = drainingProvider({ consume: 'none' })
    const input = Readable.from([Buffer.from('abc')])

    await expect(uploadWithContentHash(storage, input, opts(3))).rejects.toMatchObject({
      code: ErrorCodes.STORAGE,
      details: expect.objectContaining({ reason: 'stream-not-consumed' }),
    })
    expect(del).toHaveBeenCalledOnce()
    expect(input.destroyed).toBe(true)
  })

  describe('cleanup when the provider or source fails', () => {
    function rejectingProvider(readBeforeFailing: number) {
      let received: Readable | undefined
      const storage: IStorageProvider = {
        providerName: 'test',
        upload: async (input) => {
          received = input as Readable
          let read = 0
          if (readBeforeFailing > 0) {
            for await (const chunk of received as AsyncIterable<Buffer>) {
              read += chunk.length
              if (read >= readBeforeFailing) break
            }
          }
          throw new Error('provider refused')
        },
        delete: vi.fn(async () => {}),
        getUrl: (p) => p,
      }
      return { storage, received: () => received }
    }

    it('destroys both sides when the provider rejects before reading', async () => {
      const { storage, received } = rejectingProvider(0)
      const input = endless()

      await expect(uploadWithContentHash(storage, input, opts(10))).rejects.toThrow(
        'provider refused'
      )
      expect(input.destroyed).toBe(true)
      expect(received()?.destroyed).toBe(true)
    })

    it('destroys both sides when the provider rejects part-way', async () => {
      const { storage, received } = rejectingProvider(4096)
      const input = endless()

      await expect(uploadWithContentHash(storage, input, opts(1_000_000))).rejects.toThrow(
        'provider refused'
      )
      expect(input.destroyed).toBe(true)
      expect(received()?.destroyed).toBe(true)
    })

    it('surfaces a source failure through the provider and releases the input', async () => {
      const { storage } = drainingProvider()
      const input = new Readable({ read() {} })
      const pending = uploadWithContentHash(storage, input, opts(100))
      input.push(Buffer.from('partial'))
      setTimeout(() => input.destroy(new Error('source broke')), 5)

      await expect(pending).rejects.toThrow('source broke')
      expect(input.destroyed).toBe(true)
    })

    it('absorbs a source error raised after the provider has rejected', async () => {
      const { storage } = rejectingProvider(0)
      const input = new Readable({ read() {} })

      await expect(uploadWithContentHash(storage, input, opts(10))).rejects.toThrow(
        'provider refused'
      )
      // Would be an unhandled 'error' event (and fail the run) without cleanup.
      input.emit('error', new Error('late'))
    })

    it('reports objectDeleted: false when deleting the partial object fails', async () => {
      const { storage, del } = drainingProvider()
      del.mockRejectedValueOnce(new Error('delete failed'))

      await expect(
        uploadWithContentHash(storage, Readable.from([Buffer.from('abc')]), opts(10))
      ).rejects.toMatchObject({
        details: expect.objectContaining({ reason: 'size-mismatch', objectDeleted: false }),
      })
    })
  })
})
