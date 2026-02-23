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
   * @example `'./public/uploads'`
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
 *   `media/2026/02/a1b2c3d4-e5f6-...-photo.jpg`
 */
function buildStoragePath(collection: string | undefined, filename: string): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const uid = uuidv4()
  const safe = sanitiseFilename(filename)
  const prefix = collection ?? 'uploads'
  return `${prefix}/${year}/${month}/${uid}-${safe}`
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
    const storagePath = buildStoragePath(options.collection, options.filename)
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
      storage_provider: this.providerName,
      storage_path: storagePath,
      storage_url: this.getUrl(storagePath),
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
 *   `<collection>/<year>/<month>/<uuid>-<filename>`
 *
 * The provider generates a public URL by prepending `baseUrl` to the
 * storage path. Pair this with a static file server (e.g. Express
 * `express.static`, TanStack Start's static file serving, or nginx) that
 * serves the `uploadDir` directory at the `baseUrl` path.
 *
 * @example
 * ```ts
 * import { localStorageProvider } from '@byline/storage-local'
 *
 * // In byline.server.config.ts:
 * defineServerConfig({
 *   ...config,
 *   db: pgAdapter({ connectionString: process.env.DB_CONNECTION_STRING! }),
 *   storage: localStorageProvider({
 *     uploadDir: './public/uploads',
 *     baseUrl: '/uploads',
 *   }),
 * })
 * ```
 */
export function localStorageProvider(config: LocalStorageConfig): IStorageProvider {
  return new LocalStorageProvider(config)
}
