/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { IStorageProvider, StoredFileLocation, UploadFileOptions } from '@byline/core'
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

/**
 * Build a namespaced storage sub-path, e.g.:
 *   `media/a1b2c3d4-e5f6-...-photo.jpg`
 *
 * The UUIDv4 prefix is sufficient to prevent filename collisions without the
 * extra year/month directory nesting, and it simplifies variant path derivation
 * and cleanup on deletion.
 */
function buildStoragePath(collection: string | undefined, filename: string): string {
  const uid = uuidv4()
  const safe = sanitiseFilename(filename)
  const prefix = collection ?? 'uploads'
  return `${prefix}/${uid}-${safe}`
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
    const storagePath =
      options.targetStoragePath ?? buildStoragePath(options.collection, options.filename)
    const absolutePath = path.join(this.uploadDir, storagePath)

    // Ensure the target directory exists.
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

    if (Buffer.isBuffer(stream)) {
      await fs.promises.writeFile(absolutePath, stream)
    } else {
      const writeStream = fs.createWriteStream(absolutePath)
      await pipeline(stream, writeStream)
    }

    return {
      storageProvider: this.providerName,
      storagePath: storagePath,
      storageUrl: this.getUrl(storagePath),
    }
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

    try {
      await fs.promises.rename(fromAbsolute, toAbsolute)
    } catch (err: unknown) {
      // `rename` fails with EXDEV when uploadDir spans filesystems (e.g. a
      // mounted volume boundary). Fall back to copy + unlink.
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.promises.copyFile(fromAbsolute, toAbsolute)
        await fs.promises.unlink(fromAbsolute)
      } else {
        throw err
      }
    }

    return {
      storageProvider: this.providerName,
      storagePath: toPath,
      storageUrl: this.getUrl(toPath),
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
 *   `<collection>/<uuid>-<filename>`
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
