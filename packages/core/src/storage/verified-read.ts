/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Server-only: published through `@byline/core/stored-files`. It hashes and spools with
// Node built-ins, so it must stay out of the browser-safe main entry.

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { type FileHandle, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { isSourceVerificationEvidence } from '../extraction/evidence.js'
import { ERR_STORAGE, ErrorCodes } from '../lib/errors.js'
import { isSameStorageValidator } from './content-hash.js'
import type {
  PreconditionFallbackReason,
  SourceIdentityProblem,
  SourceUnavailableReason,
  SourceVerificationEvidence,
} from '../@types/extraction-types.js'
import type { StoredFileValue } from '../@types/field-data-types.js'
import type {
  IStorageProvider,
  StoragePreconditionReason,
  StorageValidator,
  StoredObjectRead,
} from '../@types/storage-types.js'

/**
 * The file name prefix of a spooled body. A process crash between spooling and
 * `dispose` leaves such a file in the temporary directory, and the prefix lets an
 * operator find and remove it.
 *
 * @provisional
 */
export const VERIFIED_SOURCE_SPOOL_PREFIX = 'byline-verified-source-'

const DEFAULT_MEMORY_THRESHOLD = 8 * 1024 * 1024

/**
 * Verified source bytes. The caller disposes of the body in a `finally` block.
 *
 * @provisional
 */
export interface VerifiedSourceBody {
  readonly size: number
  /** A fresh web stream over the verified bytes; may be opened more than once. */
  stream(): ReadableStream<Uint8Array>
  /** A copy of the verified bytes in memory. Avoid for large files. */
  bytes(): Promise<Uint8Array>
  /** Deletes any spool file. Idempotent. */
  dispose(): Promise<void>
}

/**
 * The outcome of a source read. It is returned rather than thrown, so a caller handles
 * each case explicitly. A precondition that prevented reading yields no `observedHash`.
 *
 * @provisional
 */
export type VerifiedSourceRead =
  | { status: 'verified'; evidence: SourceVerificationEvidence; body: VerifiedSourceBody }
  | {
      status: 'identity-problem'
      problem: SourceIdentityProblem
      storagePath: string
      /** Absent for `missing-hash`. */
      expectedHash?: string
      /** Only for `hash-mismatch`. */
      observedHash?: string
      /** Only for `hash-mismatch`. */
      observedValidator?: StorageValidator
      preconditionFallback?: PreconditionFallbackReason
    }
  | { status: 'unavailable'; reason: SourceUnavailableReason; cause?: unknown }

/**
 * The outcome of a change probe.
 *
 * `unprobed` is reduced assurance, not `unchanged`. With `head-unsupported`, a caller
 * may reuse a verified artifact without a probe, and only separate verify runs detect a
 * same-path replacement. With `no-evidence`, reuse is not permitted.
 *
 * @provisional
 */
export type SourceProbe =
  | { status: 'unchanged'; validator: StorageValidator }
  /** Read with `knownChanged`; the hash decides. */
  | { status: 'changed'; validator: StorageValidator }
  | { status: 'missing-object' }
  | { status: 'unprobed'; reason: 'head-unsupported' | 'no-evidence' }
  | { status: 'unavailable'; cause: unknown }

/** Destroys a stream if it can be destroyed. */
export function destroyStream(stream: NodeJS.ReadableStream, reason?: unknown): void {
  const destroyable = stream as NodeJS.ReadableStream & { destroy?: (err?: Error) => void }
  destroyable.destroy?.(reason instanceof Error ? reason : undefined)
}

/**
 * Reads a stream to its end, handing each chunk to `onChunk` in order. An abort destroys
 * the stream, which rejects the read, and an abort that fires as the stream ends rejects
 * too. The chunk may be reused by the stream, so `onChunk` copies anything it keeps.
 */
export async function consumeStream(
  stream: NodeJS.ReadableStream,
  options: { signal?: AbortSignal; onChunk: (chunk: Buffer) => void | Promise<void> }
): Promise<void> {
  const { signal, onChunk } = options
  if (signal?.aborted) {
    // An already-aborted signal never fires 'abort'; release the stream here.
    // Destroy without an error: nothing listens to this stream yet, so an
    // error argument would surface as an unhandled 'error' event.
    destroyStream(stream)
    signal.throwIfAborted()
  }
  const onAbort = () => destroyStream(stream, signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      await onChunk(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  // Destroying a stream that has already ended does not reject the iteration above.
  signal?.throwIfAborted()
}

function preconditionReason(error: unknown): StoragePreconditionReason | null {
  const candidate = error as { code?: unknown; details?: { reason?: unknown } } | null
  if (candidate?.code !== ErrorCodes.STORAGE_PRECONDITION) return null
  const reason = candidate.details?.reason
  // An unrecognised reason means the expectation could not be checked.
  return reason === 'changed' || reason === 'unsupported-kind' || reason === 'missing'
    ? reason
    : 'unestablishable'
}

/** Holds bytes in memory up to a threshold, then in a private file. */
class BodySink {
  private chunks: Buffer[] = []
  private handle: FileHandle | undefined
  private path: string | undefined
  size = 0

  constructor(private readonly memoryThreshold: number) {}

  async write(chunk: Buffer): Promise<void> {
    this.size += chunk.length
    if (this.handle === undefined && this.size <= this.memoryThreshold) {
      this.chunks.push(chunk)
      return
    }
    if (this.handle === undefined) {
      this.path = join(
        tmpdir(),
        `${VERIFIED_SOURCE_SPOOL_PREFIX}${randomBytes(16).toString('hex')}`
      )
      // `wx` refuses an existing path; the mode keeps the bytes private.
      this.handle = await open(this.path, 'wx', 0o600)
      for (const buffered of this.chunks) await this.handle.writeFile(buffered)
      this.chunks = []
    }
    await this.handle.writeFile(chunk)
  }

  async finish(): Promise<VerifiedSourceBody> {
    if (this.handle !== undefined) {
      await this.handle.close()
      this.handle = undefined
    }
    return this.path === undefined
      ? memoryBody(Buffer.concat(this.chunks))
      : spoolBody(this.path, this.size)
  }

  /** Removes everything. Never throws: the read's own failure is what matters. */
  async discard(): Promise<void> {
    this.chunks = []
    await this.handle?.close().catch(() => {})
    this.handle = undefined
    if (this.path !== undefined) await rm(this.path, { force: true }).catch(() => {})
  }
}

function assertNotDisposed(disposed: boolean): void {
  if (disposed) throw new Error('This verified source body has been disposed.')
}

function memoryBody(buffer: Buffer): VerifiedSourceBody {
  let disposed = false
  return {
    size: buffer.length,
    stream() {
      assertNotDisposed(disposed)
      const copy = new Uint8Array(buffer)
      return new ReadableStream<Uint8Array>({
        start(controller) {
          if (copy.length > 0) controller.enqueue(copy)
          controller.close()
        },
      })
    },
    async bytes() {
      assertNotDisposed(disposed)
      return new Uint8Array(buffer)
    },
    async dispose() {
      disposed = true
    },
  }
}

function spoolBody(path: string, size: number): VerifiedSourceBody {
  let disposal: Promise<void> | undefined
  return {
    size,
    stream() {
      assertNotDisposed(disposal !== undefined)
      return Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>
    },
    async bytes() {
      assertNotDisposed(disposal !== undefined)
      return new Uint8Array(await readFile(path))
    },
    dispose() {
      disposal ??= rm(path, { force: true })
      return disposal
    },
  }
}

/**
 * Reads a stored file and verifies it against the reference's `fileHash`. The body is
 * read to its end and hashed before any caller sees a byte, so only verified bytes can
 * reach an extractor.
 *
 * - Makes at most two reads. A `changed`, `unsupported-kind` or `unestablishable`
 *   precondition leads to exactly one unconditional read, because a changed token does
 *   not prove changed content and the hash decides.
 * - The evidence validator is the one returned by this read, never one from a probe or
 *   from the saved value.
 * - Never writes to storage, never changes the saved value, and never accepts different
 *   bytes. Force is a work decision, not a verification bypass.
 *
 * Throws only for a malformed `memoryThreshold`, which is a caller bug.
 *
 * @provisional
 */
export async function readVerifiedSource(
  storage: IStorageProvider,
  source: Pick<
    StoredFileValue,
    'storagePath' | 'storageProvider' | 'fileHash' | 'storageValidator'
  >,
  options?: {
    /** Skip the expectation: a probe already showed a different validator. */
    knownChanged?: boolean
    signal?: AbortSignal
    /** Bytes kept in memory before spooling to a temporary file. Default 8 MiB. */
    memoryThreshold?: number
  }
): Promise<VerifiedSourceRead> {
  const memoryThreshold = options?.memoryThreshold ?? DEFAULT_MEMORY_THRESHOLD
  if (!Number.isSafeInteger(memoryThreshold) || memoryThreshold < 0) {
    throw new TypeError('memoryThreshold must be a non-negative integer')
  }
  const { storagePath, fileHash } = source
  const signal = options?.signal

  if (fileHash === undefined || fileHash === null || fileHash === '') {
    return { status: 'identity-problem', problem: 'missing-hash', storagePath }
  }
  if (source.storageProvider !== storage.providerName) {
    return { status: 'unavailable', reason: 'provider-mismatch' }
  }
  if (storage.download === undefined) {
    return { status: 'unavailable', reason: 'download-unsupported' }
  }

  const failure = (cause: unknown): VerifiedSourceRead => ({
    status: 'unavailable',
    reason: signal?.aborted === true ? 'aborted' : 'read-failed',
    cause,
  })
  if (signal?.aborted) return failure(signal.reason)

  const expect = options?.knownChanged === true ? undefined : (source.storageValidator ?? undefined)
  let fallback: PreconditionFallbackReason | undefined

  const missingObject = (): VerifiedSourceRead => ({
    status: 'identity-problem',
    problem: 'missing-object',
    storagePath,
    expectedHash: fileHash,
    ...(fallback !== undefined && { preconditionFallback: fallback }),
  })

  let read: StoredObjectRead | null
  try {
    read = await storage.download(storagePath, {
      ...(expect !== undefined && { expect }),
      ...(signal !== undefined && { signal }),
    })
  } catch (error) {
    const reason = preconditionReason(error)
    if (reason === null) return failure(error)
    if (reason === 'missing') return missingObject()
    fallback = reason
    try {
      read = await storage.download(storagePath, signal !== undefined ? { signal } : {})
    } catch (fallbackError) {
      // There is never a third read. Only `missing` keeps a specific meaning here.
      return preconditionReason(fallbackError) === 'missing'
        ? missingObject()
        : failure(fallbackError)
    }
  }
  if (read === null) return missingObject()

  const sink = new BodySink(memoryThreshold)
  const hash = createHash('sha256')
  try {
    await consumeStream(read.body, {
      ...(signal !== undefined && { signal }),
      onChunk: async (chunk) => {
        // A stream may reuse its buffer, so the body must own the bytes it hashed.
        const owned = Buffer.from(chunk)
        hash.update(owned)
        await sink.write(owned)
      },
    })
    if (read.size !== undefined && read.size !== sink.size) {
      throw ERR_STORAGE({
        message: `The body ended at ${sink.size} bytes, but the provider reported ${read.size}.`,
        details: { reason: 'size-mismatch', actualSize: sink.size, declaredSize: read.size },
      })
    }
  } catch (error) {
    destroyStream(read.body)
    await sink.discard()
    return failure(error)
  }

  const observedHash = hash.digest('hex')
  if (observedHash !== fileHash) {
    await sink.discard()
    return {
      status: 'identity-problem',
      problem: 'hash-mismatch',
      storagePath,
      expectedHash: fileHash,
      observedHash,
      observedValidator: read.validator,
      ...(fallback !== undefined && { preconditionFallback: fallback }),
    }
  }

  const evidence: SourceVerificationEvidence = {
    expectedHash: fileHash,
    contentHash: observedHash,
    validator: read.validator,
    verifiedAt: new Date().toISOString(),
    size: sink.size,
    readBasis:
      fallback !== undefined ? 'fallback' : expect !== undefined ? 'expected' : 'unconditional',
    ...(fallback !== undefined && { preconditionFallback: fallback }),
  }
  if (!isSourceVerificationEvidence(evidence, { expectedHash: fileHash })) {
    await sink.discard()
    return failure(
      ERR_STORAGE({
        message: `Storage provider '${storage.providerName}' returned an unusable validator.`,
        details: { reason: 'validator-unavailable', storagePath },
      })
    )
  }

  try {
    const body = await sink.finish()
    if (signal?.aborted) {
      await body.dispose()
      return failure(signal.reason)
    }
    return { status: 'verified', evidence, body }
  } catch (error) {
    await sink.discard()
    return failure(error)
  }
}

/**
 * Compares the stored object's current validator with the **evidence's** validator,
 * never the reference's saved one, so a matching copied value cannot stand in for
 * verification. A different validator, or one of a different kind, is `changed`: the
 * caller reads with `knownChanged`, and the hash decides.
 *
 * An unchanged probe does not establish a first baseline, and does not prove the object
 * cannot change afterwards.
 *
 * @provisional
 */
export async function probeVerifiedSource(
  storage: IStorageProvider,
  storagePath: string,
  evidence: SourceVerificationEvidence | null
): Promise<SourceProbe> {
  if (!isSourceVerificationEvidence(evidence)) return { status: 'unprobed', reason: 'no-evidence' }
  if (storage.head === undefined) return { status: 'unprobed', reason: 'head-unsupported' }
  try {
    const head = await storage.head(storagePath)
    if (head === null) return { status: 'missing-object' }
    return isSameStorageValidator(head.validator, evidence.validator)
      ? { status: 'unchanged', validator: head.validator }
      : { status: 'changed', validator: head.validator }
  } catch (cause) {
    return { status: 'unavailable', cause }
  }
}
