/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type {
  IStorageProvider,
  StorageDownloadOptions,
  StorageValidator,
  StoredFileLocation,
  StoredObjectHead,
  StoredObjectRead,
  UploadFileOptions,
} from '@byline/core'
import { ERR_STORAGE, ERR_STORAGE_PRECONDITION, isSameStorageValidator } from '@byline/core'
import { v4 as uuidv4 } from 'uuid'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LocalStorageConfig {
  /**
   * Absolute or project-relative path to the root directory where uploaded
   * files will be stored.
   *
   * For TanStack Start + Nitro hosts, keep this OUTSIDE `public/` — anything
   * under `public/` is snapshotted into `.output/public/` at build time and
   * served by Nitro's static handler from that snapshot, so files written at
   * runtime won't appear until the next rebuild. Pair `uploadDir` with a
   * runtime handler in your server entry that streams from this directory
   * on every request.
   *
   * @example `'./uploads'`
   */
  uploadDir: string
  /**
   * Base URL prefix used to build public file URLs.
   * Trailing slash is normalised automatically.
   *
   * @example `'/uploads'`
   * @example `'https://cdn.example.com/media'`
   */
  baseUrl: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitise a filename so it is safe for the filesystem.
 * Lowercases, replaces unsafe characters with hyphens, collapses runs of
 * hyphens, and trims leading/trailing hyphens from the base name.
 */
function sanitiseFilename(filename: string): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${safe || 'file'}${ext.toLowerCase()}`
}

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Short random base36 suffix appended to stored basenames. Six characters
 * (36^6 ≈ 2.2 billion) keep filenames human-friendly while making
 * collisions among same-named files in one scope vanishingly rare — and
 * the upload path verifies availability with `exists()` and retries, so
 * the residual risk is handled rather than merely improbable.
 */
function randomSuffix(length = 6): string {
  let out = ''
  for (const byte of randomBytes(length)) {
    out += SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length)
  }
  return out
}

/**
 * Compose a candidate storage sub-path, e.g.:
 *   `events/meeting-agenda-4fa35g.pdf`
 *
 * `scope` is the field's `upload.location` when declared (may carry nested
 * segments, e.g. `news/attachments`), else the collection path. The
 * filename leads (arriving pre-slugified from `uploadField`'s configurable
 * filename slugifier; `sanitiseFilename` re-applies the default rules as a
 * safety net for direct callers) and the entropy rides as a short suffix
 * before the extension — friendly to download as, browse, and log.
 */
/** Validator kind issued by this provider. */
const LOCAL_VALIDATOR_KIND = 'local-stat'

/**
 * `local-stat` validator: device, inode, nanosecond modification time and
 * size. Every Byline write creates a new file and renames it into place, so a
 * replacement always yields a new inode and therefore a new validator.
 */
function statValidator(stats: fs.BigIntStats): StorageValidator {
  return {
    kind: LOCAL_VALIDATOR_KIND,
    value: `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.size}`,
  }
}

/** Sibling temporary path in the destination directory (same filesystem, so rename is atomic). */
function temporarySibling(absolutePath: string): string {
  return `${absolutePath}.${randomSuffix(10)}.tmp`
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT'
}

function preconditionFailed(
  reason: 'changed' | 'unsupported-kind' | 'missing',
  storagePath: string,
  expect: StorageValidator,
  actual?: StorageValidator
) {
  return ERR_STORAGE_PRECONDITION({
    message: `Storage precondition failed for '${storagePath}' (${reason}).`,
    details: { reason, storagePath, expect, ...(actual && { actual }) },
  })
}

function buildStoragePath(scope: string | undefined, filename: string, suffix: string): string {
  const safe = sanitiseFilename(filename)
  const ext = path.extname(safe)
  const base = path.basename(safe, ext)
  return `${scope ?? 'uploads'}/${base}-${suffix}${ext}`
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

class LocalStorageProvider implements IStorageProvider {
  readonly providerName = 'local'

  readonly uploadDir: string
  private readonly baseUrl: string

  constructor(config: LocalStorageConfig) {
    this.uploadDir = config.uploadDir
    // Normalise: no trailing slash on baseUrl.
    this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl
  }

  async upload(
    stream: NodeJS.ReadableStream | Buffer,
    options: UploadFileOptions
  ): Promise<StoredFileLocation> {
    const storagePath = options.targetStoragePath ?? (await this.availableStoragePath(options))
    const absolutePath = path.join(this.uploadDir, storagePath)

    // Ensure the target directory exists.
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

    // Write a new file beside the destination and rename it into place. A
    // reader never sees a partial file, and a reader that already has the old
    // file open keeps reading the old inode.
    const temporaryPath = temporarySibling(absolutePath)
    try {
      if (Buffer.isBuffer(stream)) {
        await fs.promises.writeFile(temporaryPath, stream, { flag: 'wx' })
      } else {
        const writeStream = fs.createWriteStream(temporaryPath, { flags: 'wx' })
        await pipeline(stream, writeStream)
      }
      // The temporary name is private to this call, so a path stat cannot
      // observe another writer. Rename preserves the inode and timestamps.
      const stats = await fs.promises.stat(temporaryPath, { bigint: true })
      await fs.promises.rename(temporaryPath, absolutePath)

      return {
        storageProvider: this.providerName,
        storagePath: storagePath,
        storageUrl: this.getUrl(storagePath),
        storageValidator: statValidator(stats),
      }
    } catch (err: unknown) {
      await fs.promises.rm(temporaryPath, { force: true })
      throw err
    }
  }

  /**
   * Pick an unclaimed storage path: compose the friendly key, verify it is
   * free, and retry with a fresh suffix on collision. After three straight
   * collisions (pathological — a same-named file avalanche) fall back to a
   * full-entropy UUID suffix, which cannot realistically collide.
   */
  private async availableStoragePath(options: UploadFileOptions): Promise<string> {
    const scope = options.location ?? options.collection
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = buildStoragePath(scope, options.filename, randomSuffix())
      if (!(await this.exists(candidate))) return candidate
    }
    return buildStoragePath(scope, options.filename, uuidv4())
  }

  async delete(storagePath: string): Promise<void> {
    const absolutePath = path.join(this.uploadDir, storagePath)
    try {
      await fs.promises.unlink(absolutePath)
    } catch (err: unknown) {
      // Treat delete as idempotent — ignore "file not found" errors.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
    }
  }

  async move(fromPath: string, toPath: string): Promise<StoredFileLocation> {
    const fromAbsolute = path.join(this.uploadDir, fromPath)
    const toAbsolute = path.join(this.uploadDir, toPath)

    // Ensure the target directory exists.
    fs.mkdirSync(path.dirname(toAbsolute), { recursive: true })

    const location = (validator: StorageValidator): StoredFileLocation => ({
      storageProvider: this.providerName,
      storagePath: toPath,
      storageUrl: this.getUrl(toPath),
      storageValidator: validator,
    })

    // Claim the source first: an atomic rename to a private name in the
    // source directory takes exactly the file at `fromPath` now, even if a
    // Byline upload replaces `fromPath` a moment later. Everything after this
    // works on the private name, so the validator always describes the file
    // that reaches the destination, and a later source never gets removed.
    const claimedPath = temporarySibling(fromAbsolute)
    await fs.promises.rename(fromAbsolute, claimedPath)

    // From here until the destination is committed, every failure goes
    // through `restoreClaimedSource`, so the source is put back or the error
    // names where the content is.
    let claimedValidator: StorageValidator
    try {
      // The claimed name is private, so a path stat cannot observe another writer.
      claimedValidator = statValidator(await fs.promises.stat(claimedPath, { bigint: true }))
    } catch (err: unknown) {
      throw await this.restoreClaimedSource(claimedPath, fromAbsolute, fromPath, err)
    }

    // Same filesystem: a rename moves the inode, so the validator is preserved.
    try {
      await fs.promises.rename(claimedPath, toAbsolute)
      return location(claimedValidator)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw await this.restoreClaimedSource(claimedPath, fromAbsolute, fromPath, err)
      }
    }

    // Across filesystems (`EXDEV`, e.g. a mounted volume boundary): never copy
    // onto the destination in place, which would change an inode a reader may
    // have open. Copy to a temporary sibling, rename it into place, then
    // remove the claimed source. The destination gets a new inode and validator.
    const temporaryPath = temporarySibling(toAbsolute)
    let validator: StorageValidator
    try {
      await fs.promises.copyFile(claimedPath, temporaryPath, fs.constants.COPYFILE_EXCL)
      validator = statValidator(await fs.promises.stat(temporaryPath, { bigint: true }))
      await fs.promises.rename(temporaryPath, toAbsolute)
    } catch (err: unknown) {
      // Cleanup must not bypass restoration or replace the primary error.
      let temporaryRetained = false
      try {
        await fs.promises.rm(temporaryPath, { force: true })
      } catch {
        temporaryRetained = true
      }
      throw await this.restoreClaimedSource(
        claimedPath,
        fromAbsolute,
        fromPath,
        err,
        temporaryRetained ? temporaryPath : undefined
      )
    }

    try {
      await fs.promises.unlink(claimedPath)
    } catch (err: unknown) {
      throw ERR_STORAGE({
        message:
          `Moved '${fromPath}' to '${toPath}', but could not remove the claimed source copy. ` +
          'The destination is committed; record it and retry removing the claimed copy.',
        details: {
          reason: 'source-not-removed',
          destinationCommitted: true,
          fromPath,
          claimedPath: path.relative(this.uploadDir, claimedPath),
          location: location(validator),
        },
        cause: err,
      })
    }
    return location(validator)
  }

  /**
   * Put a claimed source back after a failed move, without overwriting a
   * file that has since been written at the source path (`link` refuses an
   * existing destination). Returns the error the caller should throw: the
   * primary failure when everything was put back cleanly, otherwise an
   * `ERR_STORAGE` that keeps the primary failure as its cause and names any
   * path still holding content (`claimedPath`, `temporaryPath`).
   */
  private async restoreClaimedSource(
    claimedPath: string,
    fromAbsolute: string,
    fromPath: string,
    cause: unknown,
    retainedTemporaryPath?: string
  ): Promise<unknown> {
    const retained = retainedTemporaryPath
      ? { temporaryPath: path.relative(this.uploadDir, retainedTemporaryPath) }
      : {}
    try {
      await fs.promises.link(claimedPath, fromAbsolute)
    } catch (restoreErr: unknown) {
      return ERR_STORAGE({
        message:
          `Move from '${fromPath}' failed and the source could not be put back; ` +
          'its content remains at the claimed path.',
        details: {
          reason: 'source-not-restored',
          destinationCommitted: false,
          fromPath,
          claimedPath: path.relative(this.uploadDir, claimedPath),
          restoreError: (restoreErr as NodeJS.ErrnoException).code,
          ...retained,
        },
        cause,
      })
    }

    // The source is back at `fromPath`; the claimed name is now a second link.
    let claimRetained = false
    try {
      await fs.promises.unlink(claimedPath)
    } catch {
      claimRetained = true
    }
    if (!claimRetained && !retainedTemporaryPath) return cause
    return ERR_STORAGE({
      message:
        `Move from '${fromPath}' failed. The source was restored, but a private ` +
        'copy could not be removed.',
      details: {
        reason: 'move-failed',
        destinationCommitted: false,
        sourceRestored: true,
        fromPath,
        ...(claimRetained && { claimedPath: path.relative(this.uploadDir, claimedPath) }),
        ...retained,
      },
      cause,
    })
  }

  async download(
    storagePath: string,
    options?: StorageDownloadOptions
  ): Promise<StoredObjectRead | null> {
    const expect = options?.expect
    if (expect && expect.kind !== LOCAL_VALIDATOR_KIND) {
      throw preconditionFailed('unsupported-kind', storagePath, expect)
    }
    options?.signal?.throwIfAborted()

    const absolutePath = path.join(this.uploadDir, storagePath)
    let handle: fs.promises.FileHandle
    try {
      handle = await fs.promises.open(absolutePath, 'r')
    } catch (err: unknown) {
      if (!isNotFound(err)) throw err
      if (expect) throw preconditionFailed('missing', storagePath, expect)
      return null
    }

    // The validator comes from the open handle, so it describes exactly the
    // inode the body streams from, even if the path is replaced meanwhile.
    let validator: StorageValidator
    let size: number
    try {
      const stats = await handle.stat({ bigint: true })
      validator = statValidator(stats)
      size = Number(stats.size)
      if (expect && !isSameStorageValidator(expect, validator)) {
        throw preconditionFailed('changed', storagePath, expect, validator)
      }
      options?.signal?.throwIfAborted()
    } catch (err: unknown) {
      await handle.close()
      throw err
    }

    const body = handle.createReadStream({
      autoClose: true,
      ...(options?.signal && { signal: options.signal }),
    })
    return { body, validator, size }
  }

  async head(storagePath: string): Promise<StoredObjectHead | null> {
    const absolutePath = path.join(this.uploadDir, storagePath)
    try {
      const stats = await fs.promises.stat(absolutePath, { bigint: true })
      return { validator: statValidator(stats), size: Number(stats.size) }
    } catch (err: unknown) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    const absolutePath = path.join(this.uploadDir, storagePath)
    try {
      await fs.promises.access(absolutePath, fs.constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  getUrl(storagePath: string): string {
    return `${this.baseUrl}/${storagePath}`
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a local filesystem storage provider.
 *
 * Uploaded files are written under `uploadDir`, organised into sub-paths:
 *   `<location|collection>/<filename>-<suffix>.<ext>`
 * (e.g. `events/meeting-agenda-4fa35g.pdf` — a short base36 suffix keeps
 * names friendly; availability is verified with a retry on collision).
 *
 * The provider generates a public URL by prepending `baseUrl` to the
 * storage path. Pair this with a runtime file handler (Express
 * `express.static`, an h3 handler, an nginx location block, or a small
 * `Request → Response` shim in your TanStack Start `server.ts`) that
 * serves the `uploadDir` directory at the `baseUrl` path.
 *
 * On TanStack Start + Nitro, do NOT use `nitro.publicAssets` for this:
 * `publicAssets` copies into `.output/public/<baseURL>/` at build time
 * and the Nitro static handler reads from a build-time virtual asset
 * registry, so files written after the build never resolve. Use a
 * runtime handler in `src/server.ts` instead — see the host scaffold
 * shipped by `@byline/cli` for a worked example.
 *
 * @example
 * ```ts
 * import { localStorageProvider } from '@byline/storage-local'
 *
 * // In your server config (e.g. byline/server.config.ts):
 * defineServerConfig({
 *   ...config,
 *   db: pgAdapter({ connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING! }),
 *   storage: localStorageProvider({
 *     uploadDir: './uploads',
 *     baseUrl: '/uploads',
 *   }),
 * })
 * ```
 */
export function localStorageProvider(config: LocalStorageConfig): IStorageProvider {
  return new LocalStorageProvider(config)
}
