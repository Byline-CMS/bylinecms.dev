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
  /**
   * Validator of the stored version of the object, when the provider issues
   * one. Absent when the provider has no usable validator for this write.
   * See {@link StorageValidator}.
   */
  storageValidator?: StorageValidator
}

/**
 * An opaque token a storage provider issues for one stored version of an
 * object — an S3 version id or ETag, or a local file's device, inode,
 * modification time and size.
 *
 * A validator identifies a *stored version*, not content. Its only use is
 * equality: "is the object at this path still the version I recorded?"
 * Two validators match only when both `kind` and `value` are equal; a
 * validator of a different `kind` is unknown, never "changed".
 *
 * A validator is never compared with `StoredFileValue.fileHash`. An ETag is
 * not a content digest: multipart uploads and server-side encryption give
 * ETags that are not the MD5 of the object.
 *
 * `kind` is 1–32 characters; `value` is 1–1024 characters.
 */
export interface StorageValidator {
  kind: string
  value: string
}

/** Result of a bound read — see `IStorageProvider.download`. */
export interface StoredObjectRead {
  /** The object's bytes, streamed. */
  body: NodeJS.ReadableStream
  /**
   * Validator of exactly the bytes in `body`, taken from the same request or
   * the same open file handle. This is the provider's canonical validator and
   * may be of a different kind from a `download` `expect`.
   */
  validator: StorageValidator
  /** Object size in bytes, when the provider reports it. */
  size?: number
}

/** Options for `IStorageProvider.download`. */
export interface StorageDownloadOptions {
  /**
   * Fail-closed precondition. The provider exposes the body only when it has
   * established that the current object carries a token of `expect.kind`
   * equal to `expect.value`; otherwise it rejects with
   * `ERR_STORAGE_PRECONDITION` and exposes nothing.
   */
  expect?: StorageValidator
  /** Abort the read. The provider disposes of any open body or handle. */
  signal?: AbortSignal
}

/** Result of `IStorageProvider.head`. */
export interface StoredObjectHead {
  validator: StorageValidator
  size?: number
}

/**
 * Reasons carried in `details.reason` of an `ERR_STORAGE_PRECONDITION` error.
 *
 * - `changed` — the provider established that the current object's token of
 *   the expected kind differs.
 * - `unsupported-kind` — the provider does not issue validators of the
 *   expected kind. Checked before any request.
 * - `unestablishable` — the kind is supported, but the response lacks a usable
 *   token of that kind.
 * - `missing` — no object exists at the path.
 */
export type StoragePreconditionReason =
  | 'changed'
  | 'unsupported-kind'
  | 'unestablishable'
  | 'missing'

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
   * Returns the location metadata to be recorded alongside the file entry,
   * including the stored version's validator when the provider issues one.
   *
   * Providers must store the bytes verbatim: no compression, transcoding or
   * other transform. Byline's content hash (`StoredFileValue.fileHash`) is
   * computed over the bytes passed here and relies on them being the bytes
   * stored. A stream must be consumed to its end before the promise resolves.
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

  /**
   * Bound read: stream the object and return the validator of exactly the
   * bytes streamed, taken from the same request or the same open file
   * handle. The returned validator is the provider's canonical one and may be
   * of a different kind from `expect`.
   *
   * Without `expect`: resolves `null` when no object exists at the path, and
   * fails with `ERR_STORAGE` (`details.reason: 'validator-unavailable'`) when
   * the object has no usable validator. A bound read never returns bytes
   * without a validator.
   *
   * With `expect`: exposes the body only when a token of `expect.kind` equal
   * to `expect.value` is established; otherwise fails with
   * `ERR_STORAGE_PRECONDITION` (see {@link StoragePreconditionReason}) and
   * exposes nothing.
   *
   * On every rejection after a response or handle exists, the provider
   * disposes of it before throwing.
   *
   * **Optional capability** — see `move`.
   */
  download?(storagePath: string, options?: StorageDownloadOptions): Promise<StoredObjectRead | null>

  /**
   * Cheap change probe: the current object's validator and size. Resolves
   * `null` when no object exists; fails with `ERR_STORAGE`
   * (`validator-unavailable`) for a present object without a usable
   * validator.
   *
   * Not a provenance source — the object can change after `head` returns.
   * Use `download` when bytes must be paired with their validator.
   *
   * **Optional capability** — see `move`.
   */
  head?(storagePath: string): Promise<StoredObjectHead | null>
}
