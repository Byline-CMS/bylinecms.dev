/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// ---------------------------------------------------------------------------
// Storage provider — core interfaces
// ---------------------------------------------------------------------------

/**
 * The location metadata returned by a storage provider after a successful
 * upload. These three values are stored in `store_file` alongside the rest of
 * the file metadata.
 */
export interface StoredFileLocation {
  /** Provider identifier string (e.g. `'local'`, `'s3'`). */
  storage_provider: string
  /** Provider-internal path or object key for the stored file. */
  storage_path: string
  /**
   * Public or CDN URL for the file, if available.
   * `null` when the provider requires a separate URL-generation step (e.g.
   * signed S3 URLs generated at read-time).
   */
  storage_url: string | null
}

/**
 * Options passed to `IStorageProvider.upload()` describing the file being
 * stored.
 */
export interface UploadFileOptions {
  /** Final stored filename (may differ from the original if sanitised). */
  filename: string
  /** MIME type of the file (e.g. `'image/jpeg'`). */
  mimeType: string
  /** File size in bytes. */
  size: number
  /**
   * The collection path the upload belongs to (e.g. `'media'`).
   * Providers may use this to namespace storage paths.
   */
  collection?: string
}

/**
 * The pluggable file-storage interface.
 *
 * Implement this interface to add a new storage backend. Register the
 * implementation in `ServerConfig.storage`.
 *
 * @example
 * ```ts
 * // byline.server.config.ts
 * import { localStorageProvider } from '@byline/storage-local'
 *
 * defineServerConfig({
 *   ...config,
 *   db: pgAdapter({ connectionString: process.env.DB_CONNECTION_STRING! }),
 *   storage: localStorageProvider({ uploadDir: './public/uploads', baseUrl: '/uploads' }),
 * })
 * ```
 */
export interface IStorageProvider {
  /**
   * A stable string identifier for this provider, stored in `store_file.storage_provider`.
   * e.g. `'local'`, `'s3'`.
   */
  readonly providerName: string

  /**
   * Store a file. The `stream` may be a Node.js `Readable` or a raw `Buffer`.
   * Returns the location metadata to be recorded alongside the file entry.
   */
  upload(
    stream: NodeJS.ReadableStream | Buffer,
    options: UploadFileOptions
  ): Promise<StoredFileLocation>

  /**
   * Delete a previously stored file by its `storage_path`.
   * Should resolve (not throw) if the file no longer exists.
   */
  delete(storagePath: string): Promise<void>

  /**
   * Derive a public URL for a given `storage_path` at read-time.
   *
   * For providers that embed the URL in `StoredFileLocation.storage_url` at
   * upload time (e.g. a public S3 bucket), this can simply return the same
   * value. For providers that generate signed/expiring URLs, implement the
   * signing logic here.
   */
  getUrl(storagePath: string): string
}
