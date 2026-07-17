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
  storageProvider: string
  /** Provider-internal path or object key for the stored file. */
  storagePath: string
  /**
   * Public or CDN URL for the file, if available.
   * `null` when the provider requires a separate URL-generation step (e.g.
   * signed S3 URLs generated at read-time).
   */
  storageUrl: string | null
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
  /**
   * Declarative storage-key scope replacing the `collection` default —
   * threaded from the field's `UploadConfig.location` (e.g.
   * `'news/attachments'`, nested segments allowed). Providers use it exactly
   * where they would have used `collection`, keeping their own entropy and
   * filename sanitisation (unlike `targetStoragePath`, which is written
   * verbatim and bypasses the collision guard). Ignored when
   * `targetStoragePath` is set.
   *
   * Always POSIX-style (forward slashes), no leading/trailing slash —
   * boot-validated on the schema side before it reaches providers.
   */
  location?: string
  /**
   * Explicit, fully-qualified storage path / object key the provider must
   * write to verbatim. When set, providers MUST place the file at exactly
   * this path — no entropy suffix, year/month rewrite, or `pathPrefix` injection.
   *
   * Used by the image-variant pipeline (`generateImageVariants`) to write
   * sibling files alongside an already-stored original (e.g. so the
   * `thumbnail` variant of `media/2026/05/abc-photo.jpg` lands at
   * `media/2026/05/abc-photo-thumbnail.webp`).
   *
   * Always POSIX-style (forward slashes), no leading slash. Callers are
   * responsible for sanitisation and collision-avoidance — providers do
   * not second-guess the path when this is set.
   */
  targetStoragePath?: string
}

/**
 * The pluggable file-storage interface.
 *
 * Implement this interface to add a new storage backend. Register the
 * implementation in `ServerConfig.storage`.
 *
 * @example
 * ```ts
 * // In your server config (e.g. byline/server.config.ts):
 * import { localStorageProvider } from '@byline/storage-local'
 *
 * defineServerConfig({
 *   ...config,
 *   db: pgAdapter({ connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING! }),
 *   storage: localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' }),
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
   * Derive a public URL for a given `storagePath` at read-time.
   *
   * For providers that embed the URL in `StoredFileLocation.storageUrl` at
   * upload time (e.g. a public S3 bucket), this can simply return the same
   * value. For providers that generate signed/expiring URLs, implement the
   * signing logic here.
   */
  getUrl(storagePath: string): string

  /**
   * Move (re-key) a previously stored file from one `storage_path` to
   * another, returning the new location metadata. The destination path is
   * written verbatim — same contract as `UploadFileOptions.targetStoragePath`
   * (POSIX-style, no leading slash; the caller owns sanitisation and
   * collision avoidance). Throws if the source does not exist.
   *
   * **Optional capability** — both first-party providers (`storage-local`,
   * `storage-s3`) implement it, but custom providers may not. Callers must
   * feature-detect (`if (storage.move) …`) before relying on it.
   */
  move?(fromPath: string, toPath: string): Promise<StoredFileLocation>

  /**
   * Report whether a file exists at the given `storage_path`. Useful for
   * collision checks when callers (e.g. `beforeStore` hooks assigning
   * explicit storage keys via `{ storagePath }`) need to guarantee a key
   * is free before claiming it.
   *
   * **Optional capability** — see `move`.
   */
  exists?(storagePath: string): Promise<boolean>
}
