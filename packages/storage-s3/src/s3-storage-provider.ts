/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import path from 'node:path'
import { Readable } from 'node:stream'

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { IStorageProvider, StoredFileLocation, UploadFileOptions } from '@byline/core'
import { v4 as uuidv4 } from 'uuid'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface S3StorageConfig {
  /** S3 bucket name. */
  bucket: string
  /**
   * AWS region. Required for AWS S3.
   * For region-agnostic providers (e.g. Cloudflare R2) use `'auto'`.
   */
  region: string
  /** AWS Access Key ID (or equivalent credential for compatible providers). */
  accessKeyId: string
  /** AWS Secret Access Key (or equivalent credential for compatible providers). */
  secretAccessKey: string
  /**
   * Custom endpoint for S3-compatible providers.
   *
   * @example `'https://<account-id>.r2.cloudflarestorage.com'` — Cloudflare R2
   * @example `'http://localhost:9000'`                          — MinIO (local dev)
   */
  endpoint?: string
  /**
   * Force path-style bucket addressing (`<endpoint>/<bucket>/<key>` instead of
   * `<bucket>.<endpoint>/<key>`). Required for MinIO and some other providers.
   * Defaults to `false`.
   */
  forcePathStyle?: boolean
  /**
   * Base public URL used by `getUrl()` to build human-readable file URLs.
   *
   * If omitted, a standard AWS S3 URL is derived:
   *   `https://<bucket>.s3.<region>.amazonaws.com/<storagePath>`
   *
   * @example `'https://cdn.example.com'`
   * @example `'https://pub-<hash>.r2.dev'` — Cloudflare R2 public bucket URL
   */
  publicUrl?: string
  /**
   * Optional key prefix (folder) prepended to all object keys inside the
   * bucket. No leading slash; trailing slash is added automatically.
   *
   * @example `'byline'` → keys stored as `byline/<collection>/<year>/...`
   */
  pathPrefix?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function buildObjectKey(
  pathPrefix: string | undefined,
  collection: string | undefined,
  filename: string
): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const uid = uuidv4()
  const safe = sanitiseFilename(filename)
  const scope = collection ?? 'uploads'
  const key = `${scope}/${year}/${month}/${uid}-${safe}`
  return pathPrefix ? `${pathPrefix}/${key}` : key
}

function toReadable(stream: NodeJS.ReadableStream | Buffer): Readable {
  if (Buffer.isBuffer(stream)) {
    return Readable.from(stream)
  }
  // NodeJS.ReadableStream is structurally compatible with Readable.
  return stream as Readable
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

class S3StorageProvider implements IStorageProvider {
  readonly providerName = 's3'

  private readonly client: S3Client
  private readonly bucket: string
  private readonly publicUrl: string
  private readonly pathPrefix: string | undefined

  constructor(config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
    })

    this.bucket = config.bucket
    this.pathPrefix = config.pathPrefix

    // Derive a default public URL if not explicitly provided.
    this.publicUrl =
      config.publicUrl?.replace(/\/$/, '') ??
      `https://${config.bucket}.s3.${config.region}.amazonaws.com`
  }

  async upload(
    stream: NodeJS.ReadableStream | Buffer,
    options: UploadFileOptions
  ): Promise<StoredFileLocation> {
    const objectKey = buildObjectKey(this.pathPrefix, options.collection, options.filename)

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: objectKey,
        Body: toReadable(stream),
        ContentType: options.mimeType,
        ContentLength: options.size,
      },
    })

    await upload.done()

    return {
      storage_provider: this.providerName,
      storage_path: objectKey,
      storage_url: this.getUrl(objectKey),
    }
  }

  async delete(storagePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      })
    )
  }

  getUrl(storagePath: string): string {
    return `${this.publicUrl}/${storagePath}`
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an S3-compatible storage provider.
 *
 * Works with **AWS S3**, **Cloudflare R2**, **MinIO**, and any provider that
 * implements the S3 API. Pass a custom `endpoint` and optionally
 * `forcePathStyle: true` for non-AWS providers.
 *
 * Uploaded files are stored at:
 *   `[pathPrefix/]<collection>/<year>/<month>/<uuid>-<filename>`
 *
 * @example AWS S3
 * ```ts
 * import { s3StorageProvider } from '@byline/storage-s3'
 *
 * storage: s3StorageProvider({
 *   bucket: 'my-cms-bucket',
 *   region: 'eu-west-1',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   publicUrl: 'https://cdn.example.com',
 * })
 * ```
 *
 * @example Cloudflare R2
 * ```ts
 * storage: s3StorageProvider({
 *   bucket: 'my-cms-bucket',
 *   region: 'auto',
 *   endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *   publicUrl: process.env.R2_PUBLIC_URL,  // e.g. https://pub-<hash>.r2.dev
 * })
 * ```
 *
 * @example MinIO (local dev)
 * ```ts
 * storage: s3StorageProvider({
 *   bucket: 'byline',
 *   region: 'us-east-1',
 *   endpoint: 'http://localhost:9000',
 *   forcePathStyle: true,
 *   accessKeyId: 'minioadmin',
 *   secretAccessKey: 'minioadmin',
 *   publicUrl: 'http://localhost:9000/byline',
 * })
 * ```
 */
export function s3StorageProvider(config: S3StorageConfig): IStorageProvider {
  return new S3StorageProvider(config)
}
