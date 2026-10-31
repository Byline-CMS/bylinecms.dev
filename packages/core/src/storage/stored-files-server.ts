/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Server-only stored-file identity helpers, published as
// `@byline/core/stored-files`. They hash streams incrementally with
// `node:crypto`, so they must stay out of the browser-safe main entry.

import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'

import { ERR_STORAGE, ERR_VALIDATION } from '../lib/errors.js'
import type { IDbAdapter } from '../@types/db-types.js'
import type {
  IStorageProvider,
  StorageValidator,
  StoredFileLocation,
  UploadFileOptions,
} from '../@types/storage-types.js'
import type { BylineLogger } from '../lib/logger.js'

/** SHA-256 (lower-case hex) and byte count of a stream, read to its end. */
export async function hashStream(
  stream: NodeJS.ReadableStream,
  options?: { signal?: AbortSignal }
): Promise<{ fileHash: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  const signal = options?.signal
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
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      hash.update(bytes)
      size += bytes.length
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  return { fileHash: hash.digest('hex'), size }
}

/**
 * Upload an original object and compute its content hash in the same pass.
 *
 * - A `Buffer` is hashed in memory; a length that differs from `options.size`
 *   fails before the provider is called.
 * - A stream is piped through a hashing pass-through as the provider consumes
 *   it. If it ends short, runs long, or is not fully consumed when the provider
 *   resolves, the upload fails, the input is destroyed, and no hash is
 *   returned. The object is deleted when the provider generated its path; a
 *   `targetStoragePath` write may have replaced an existing object, which
 *   cannot be undone, and the error says so.
 */
export async function uploadWithContentHash(
  storage: IStorageProvider,
  input: NodeJS.ReadableStream | Buffer,
  options: UploadFileOptions
): Promise<{ location: StoredFileLocation; fileHash: string }> {
  if (Buffer.isBuffer(input)) {
    if (input.length !== options.size) {
      throw ERR_VALIDATION({
        message: `Upload is ${input.length} bytes but declared ${options.size} bytes.`,
        details: { reason: 'size-mismatch', actualSize: input.length, declaredSize: options.size },
      })
    }
    const fileHash = createHash('sha256').update(input).digest('hex')
    const location = await storage.upload(input, options)
    return { location, fileHash }
  }

  const hash = createHash('sha256')
  let size = 0
  let ended = false
  // The provider reads this transform. Its readable side emits 'end' only
  // after the provider has consumed every byte, so `ended` is "fully read by
  // the provider", not merely "fully written by the source".
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    },
  })
  hashing.on('end', () => {
    ended = true
  })
  // A provider that rejects may never listen to the transform; keep a late
  // error from becoming an unhandled 'error' event. Errors still reach any
  // listener the provider attached.
  const swallow = () => {}
  hashing.on('error', swallow)
  // Forward a source failure to the provider through the transform.
  const onInputError = (err: Error) => hashing.destroy(err)
  input.on('error', onInputError)
  input.pipe(hashing)

  /** Detach and destroy both sides. The input's own later errors are absorbed. */
  const release = () => {
    input.unpipe(hashing)
    input.removeListener('error', onInputError)
    input.on('error', swallow)
    destroyStream(input)
    hashing.destroy()
  }

  let location: StoredFileLocation
  try {
    location = await storage.upload(hashing, options)
  } catch (err: unknown) {
    // The provider's error is the primary failure; cleanup must not mask it.
    release()
    throw err
  }

  if (!ended || size !== options.size) {
    release()
    const providerGeneratedPath = options.targetStoragePath === undefined
    let objectDeleted = false
    if (providerGeneratedPath) {
      try {
        await storage.delete(location.storagePath)
        objectDeleted = true
      } catch {
        // Reported through `objectDeleted: false`; the size failure is primary.
      }
    }
    throw ERR_STORAGE({
      message: ended
        ? `Upload stream was ${size} bytes but declared ${options.size} bytes.`
        : 'The storage provider resolved before consuming the whole upload stream.',
      details: {
        reason: ended ? 'size-mismatch' : 'stream-not-consumed',
        actualSize: size,
        declaredSize: options.size,
        storagePath: location.storagePath,
        objectDeleted,
        // A verbatim `targetStoragePath` write may have replaced an existing
        // object; Byline cannot restore it.
        replacementUndone: false,
      },
    })
  }

  input.removeListener('error', onInputError)
  return { location, fileHash: hash.digest('hex') }
}

function destroyStream(stream: NodeJS.ReadableStream, reason?: unknown): void {
  const destroyable = stream as NodeJS.ReadableStream & { destroy?: (err?: Error) => void }
  destroyable.destroy?.(reason instanceof Error ? reason : undefined)
}

// ---------------------------------------------------------------------------
// Backfill and verification
// ---------------------------------------------------------------------------

/** Options for {@link backfillStoredFileIdentity}. */
export interface BackfillStoredFileIdentityOptions {
  db: IDbAdapter
  storage: IStorageProvider
  /**
   * `'fill'` (default): record `fileHash` and `storageValidator` on rows
   * without a hash. `'verify'`: re-hash paths that already have a recorded
   * hash and report matches and mismatches; writes nothing.
   */
  mode?: 'fill' | 'verify'
  /** Restrict selection and updates to one collection's rows. */
  collectionPath?: string
  /** Distinct paths per page. Default 100. */
  batchSize?: number
  /** Maximum distinct paths to process in this run. Default: no limit. */
  limit?: number
  /** Fill mode only: read and hash, but write nothing. */
  dryRun?: boolean
  signal?: AbortSignal
  logger?: Pick<BylineLogger, 'info' | 'warn'>
}

/** Per-run summary. Each path list keeps at most 1000 entries; counts are never capped. */
export interface BackfillStoredFileIdentitySummary {
  mode: 'fill' | 'verify'
  dryRun: boolean
  /** Distinct paths selected. */
  scanned: number
  /** Paths read and hashed. */
  hashed: number
  /** Fill mode: rows updated (0 in a dry run). */
  rowsUpdated: number
  /** Paths whose object no longer exists. */
  missing: number
  /** Paths that could not be read or hashed. */
  failed: number
  /** Verify mode: recorded-hash groups equal to the current bytes. */
  matched: number
  /** Verify mode: recorded-hash groups that differ from the current bytes. */
  mismatched: number
  missingPaths: string[]
  failures: Array<{ storagePath: string; error: string }>
  mismatches: Array<{
    storagePath: string
    recordedHash: string
    currentHash: string
    rowCount: number
  }>
}

/** Maximum entries kept in each summary path list. Counts are never capped. */
const BACKFILL_REPORT_LIMIT = 1000

/**
 * Fill or verify stored-file content identity for existing `byline_store_file`
 * rows (spec 2026-10-31 §4.8).
 *
 * - Selects only rows written by `storage.providerName`, optionally one
 *   collection's rows, paging by distinct storage path. Each path is read once
 *   per run with a bound `download`, so the recorded validator always belongs
 *   to the bytes that were hashed.
 * - Fill never overwrites a recorded hash, so re-running is idempotent and an
 *   interrupted run resumes cleanly. It hashes the bytes present now: where an
 *   older version's object was later replaced at the same path, the recorded
 *   hash describes the current bytes, which the validator identifies.
 * - Legacy-null policy: a missing object, or a read or hash failure, leaves the
 *   rows without identity and is reported. A provider without `download`, or
 *   an adapter without stored-file maintenance, refuses to start.
 *
 * This is a maintenance primitive: it uses direct `db.queries` / `db.commands`
 * calls and bypasses collection auth and hooks.
 */
export async function backfillStoredFileIdentity(
  options: BackfillStoredFileIdentityOptions
): Promise<BackfillStoredFileIdentitySummary> {
  const { db, storage, signal, logger } = options
  const mode = options.mode ?? 'fill'
  const dryRun = mode === 'fill' && options.dryRun === true
  const batchSize = options.batchSize ?? 100
  const limit = options.limit ?? Number.POSITIVE_INFINITY

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw ERR_VALIDATION({
      message: 'batchSize must be a positive integer.',
      details: { batchSize },
    })
  }
  const queries = db.queries.storedFiles
  const commands = db.commands.storedFiles
  if (!queries || (mode === 'fill' && !commands)) {
    throw ERR_VALIDATION({
      message: 'The database adapter does not support stored-file identity maintenance.',
      details: { reason: 'adapter-unsupported' },
    })
  }
  if (!storage.download) {
    throw ERR_STORAGE({
      message:
        `Storage provider '${storage.providerName}' has no download(); stored-file ` +
        'identity cannot be backfilled or verified. Rows stay without identity.',
      details: { reason: 'download-unavailable', storageProvider: storage.providerName },
    })
  }

  let collectionId: string | undefined
  if (options.collectionPath !== undefined) {
    const collection = await db.queries.collections.getCollectionByPath(options.collectionPath)
    if (!collection?.id) {
      throw ERR_VALIDATION({
        message: `Unknown collection '${options.collectionPath}'.`,
        details: { reason: 'unknown-collection', collectionPath: options.collectionPath },
      })
    }
    collectionId = collection.id as string
  }

  const summary: BackfillStoredFileIdentitySummary = {
    mode,
    dryRun,
    scanned: 0,
    hashed: 0,
    rowsUpdated: 0,
    missing: 0,
    failed: 0,
    matched: 0,
    mismatched: 0,
    missingPaths: [],
    failures: [],
    mismatches: [],
  }
  const keep = <T>(list: T[], entry: T) => {
    if (list.length < BACKFILL_REPORT_LIMIT) list.push(entry)
  }

  let afterPath: string | undefined
  while (summary.scanned < limit) {
    signal?.throwIfAborted()
    const pageLimit = Math.min(batchSize, limit - summary.scanned)
    const page = await queries.listStoredFilePaths({
      storageProvider: storage.providerName,
      ...(collectionId !== undefined && { collectionId }),
      identity: mode === 'fill' ? 'missing' : 'present',
      ...(afterPath !== undefined && { afterPath }),
      limit: pageLimit,
    })

    for (const group of page) {
      signal?.throwIfAborted()
      summary.scanned += 1
      afterPath = group.storagePath

      let current: { fileHash: string; validator: StorageValidator } | null
      try {
        const read = await storage.download(group.storagePath, signal ? { signal } : undefined)
        if (!read) {
          current = null
        } else {
          const { fileHash } = await hashStream(read.body, signal ? { signal } : undefined)
          current = { fileHash, validator: read.validator }
        }
      } catch (err: unknown) {
        if (signal?.aborted) throw err
        summary.failed += 1
        const message = err instanceof Error ? err.message : String(err)
        keep(summary.failures, { storagePath: group.storagePath, error: message })
        logger?.warn({ storagePath: group.storagePath, err }, 'stored-file identity read failed')
        continue
      }

      if (!current) {
        summary.missing += 1
        keep(summary.missingPaths, group.storagePath)
        continue
      }
      summary.hashed += 1

      if (mode === 'verify') {
        for (const recorded of group.hashes) {
          if (recorded.fileHash === current.fileHash) {
            summary.matched += 1
          } else {
            summary.mismatched += 1
            keep(summary.mismatches, {
              storagePath: group.storagePath,
              recordedHash: recorded.fileHash,
              currentHash: current.fileHash,
              rowCount: recorded.rowCount,
            })
          }
        }
        continue
      }

      if (!dryRun && commands) {
        summary.rowsUpdated += await commands.setIdentityForPath({
          storageProvider: storage.providerName,
          storagePath: group.storagePath,
          ...(collectionId !== undefined && { collectionId }),
          fileHash: current.fileHash,
          storageValidator: current.validator,
        })
      }
    }

    if (page.length < pageLimit) break
  }

  logger?.info(
    { ...summary, missingPaths: undefined, failures: undefined, mismatches: undefined },
    'stored-file identity backfill finished'
  )
  return summary
}
