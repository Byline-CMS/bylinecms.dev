/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type ObjectCannedACL,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { IStorageProvider, StoredFileLocation, UploadFileOptions } from '@byline/core'
import { v4 as uuidv4 } from 'uuid'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Per-upload S3 metadata supplier. Receives the same `UploadFileOptions`
 * passed to `storage.upload()` so callers can derive metadata from the
 * collection / filename / mime type / target path. Return value is
 * forwarded as S3 user-metadata (`x-amz-meta-*` headers).
 */
export type S3MetadataSupplier =
  | Record<string, string>
  | ((options: UploadFileOptions) => Record<string, string> | undefined)

export interface S3StorageConfig {
  /** S3 bucket name. */
  bucket: string
  /**
   * AWS region. Required for AWS S3.
   * For region-agnostic providers (e.g. Cloudflare R2) use `'auto'`.
   */
  region: string
  /**
   * AWS Access Key ID (or equivalent credential for compatible providers).
   *
   * Optional — when omitted (along with `secretAccessKey`), the AWS SDK
   * resolves credentials via its default provider chain (IAM role / instance
   * profile, SSO, environment variables, `~/.aws/credentials`, etc.). This
   * is the recommended path for production AWS deployments.
   */
  accessKeyId?: string
  /**
   * AWS Secret Access Key (or equivalent credential for compatible providers).
   * Must be set together with `accessKeyId`. See `accessKeyId` for the
   * default-credential-chain fallback.
   */
  secretAccessKey?: string
  /**
   * Optional session token, for temporary credentials issued by STS / SSO.
   * Only meaningful when `accessKeyId` and `secretAccessKey` are also set.
   */
  sessionToken?: string
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
   * Ignored when `UploadFileOptions.targetStoragePath` is set — variant
   * uploads compute their key from the original's `storagePath`, which
   * already carries the prefix.
   *
   * @example `'byline'` → keys stored as `byline/<collection>/<filename>-<suffix>.<ext>`
   */
  pathPrefix?: string
  /**
   * S3 canned ACL applied to every uploaded object.
   *
   * Many modern S3 setups (AWS S3 Block-Public-Access, Cloudflare R2) reject
   * ACL headers entirely — leave this unset on those buckets and grant
   * read access via bucket policy instead.
   *
   * @example `'public-read'` — legacy public-read bucket
   */
  acl?: ObjectCannedACL
  /**
   * Default `Cache-Control` header written to every uploaded object's
   * metadata, used by S3/CDNs when serving the file. Long-lived
   * immutable URLs are common for content with collision-proof keys.
   *
   * @example `'public, max-age=31536000, immutable'`
   */
  cacheControl?: string
  /**
   * Static or per-upload S3 user-metadata. Static keys are merged with the
   * per-upload result if both are provided; per-upload values win on key
   * collision.
   *
   * Keys must be ASCII; values are quoted by the SDK as needed. Each entry
   * is sent as an `x-amz-meta-<key>` header.
   *
   * @example `{ uploader: 'byline-cms' }`
   */
  metadata?: S3MetadataSupplier
  /**
   * Escape hatch for advanced S3 client tuning — `requestHandler`,
   * `maxAttempts`, `retryMode`, custom `httpAgent`, `useArnRegion`, etc.
   * Merged into the underlying `S3Client` config; explicit named fields
   * on `S3StorageConfig` (`region`, `endpoint`, `forcePathStyle`,
   * credentials) take precedence on key collision.
   */
  clientConfig?: Partial<S3ClientConfig>
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

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Short random base36 suffix appended to stored basenames. Six characters
 * (36^6 ≈ 2.2 billion) keep filenames human-friendly while making
 * collisions among same-named files in one scope vanishingly rare — and
 * the upload path verifies availability with `exists()` (one HeadObject)
 * and retries, so the residual risk is handled rather than merely
 * improbable.
 */
function randomSuffix(length = 6): string {
  let out = ''
  for (const byte of randomBytes(length)) {
    out += SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length)
  }
  return out
}

/**
 * Compose a candidate object key, e.g.:
 *   `[pathPrefix/]events/meeting-agenda-4fa35g.pdf`
 *
 * `scope` is the field's `upload.location` when declared (may carry nested
 * segments, e.g. `news/attachments`), else the collection path. The
 * filename leads (arriving pre-slugified from `uploadField`'s configurable
 * filename slugifier; `sanitiseFilename` re-applies the default rules as a
 * safety net for direct callers) and the entropy rides as a short suffix
 * before the extension — friendly to download as, browse in the console,
 * and log. At CMS scales the reduced key-prefix scatter is irrelevant to
 * S3's per-prefix request limits (thousands of requests/second — orders of
 * magnitude above editorial traffic).
 */
function buildObjectKey(
  pathPrefix: string | undefined,
  scope: string | undefined,
  filename: string,
  suffix: string
): string {
  const safe = sanitiseFilename(filename)
  const ext = path.extname(safe)
  const base = path.basename(safe, ext)
  const key = `${scope ?? 'uploads'}/${base}-${suffix}${ext}`
  return pathPrefix ? `${pathPrefix}/${key}` : key
}

function toReadable(stream: NodeJS.ReadableStream | Buffer): Readable {
  if (Buffer.isBuffer(stream)) {
    return Readable.from(stream)
  }
  // NodeJS.ReadableStream is structurally compatible with Readable.
  return stream as Readable
}

function resolveMetadata(
  supplier: S3MetadataSupplier | undefined,
  options: UploadFileOptions
): Record<string, string> | undefined {
  if (!supplier) return undefined
  if (typeof supplier === 'function') {
    const value = supplier(options)
    return value && Object.keys(value).length > 0 ? value : undefined
  }
  return Object.keys(supplier).length > 0 ? supplier : undefined
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
  private readonly acl: ObjectCannedACL | undefined
  private readonly cacheControl: string | undefined
  private readonly metadata: S3MetadataSupplier | undefined

  constructor(config: S3StorageConfig) {
    // Pass an explicit `credentials` block only when both halves of a
    // long-lived key pair are present. Otherwise leave it absent so the
    // SDK falls back to its default credential provider chain (IAM role,
    // SSO, env, ~/.aws/credentials).
    const explicitCredentials =
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
          }
        : undefined

    this.client = new S3Client({
      ...config.clientConfig,
      region: config.region,
      ...(explicitCredentials ? { credentials: explicitCredentials } : {}),
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
    })

    this.bucket = config.bucket
    this.pathPrefix = config.pathPrefix
    this.acl = config.acl
    this.cacheControl = config.cacheControl
    this.metadata = config.metadata

    // Derive a default public URL if not explicitly provided.
    this.publicUrl =
      config.publicUrl?.replace(/\/$/, '') ??
      `https://${config.bucket}.s3.${config.region}.amazonaws.com`
  }

  async upload(
    stream: NodeJS.ReadableStream | Buffer,
    options: UploadFileOptions
  ): Promise<StoredFileLocation> {
    const objectKey = options.targetStoragePath ?? (await this.availableObjectKey(options))

    const userMetadata = resolveMetadata(this.metadata, options)

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: objectKey,
        Body: toReadable(stream),
        ContentType: options.mimeType,
        ContentLength: options.size,
        ...(this.acl ? { ACL: this.acl } : {}),
        ...(this.cacheControl ? { CacheControl: this.cacheControl } : {}),
        ...(userMetadata ? { Metadata: userMetadata } : {}),
      },
    })

    await upload.done()

    return {
      storageProvider: this.providerName,
      storagePath: objectKey,
      storageUrl: this.getUrl(objectKey),
    }
  }

  async delete(storagePath: string): Promise<void> {
    // S3 DeleteObject is idempotent — succeeds (204) whether the key
    // exists or not — so no need for a NotFound branch here.
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      })
    )
  }

  async move(fromPath: string, toPath: string): Promise<StoredFileLocation> {
    // S3 has no native rename — copy to the new key, then delete the
    // original. CopyObject throws NoSuchKey when the source is missing,
    // satisfying the interface's "throws if the source does not exist".
    // The default MetadataDirective (COPY) carries the source object's
    // Content-Type, Cache-Control, and user metadata to the new key —
    // exactly what a rename should do. ACLs are not copied by S3, so
    // re-apply the configured canned ACL when one is set.
    // Note: CopySource must be URL-encoded (keys may contain characters
    // that are significant in the `<bucket>/<key>` source string).
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: encodeURIComponent(`${this.bucket}/${fromPath}`),
        Key: toPath,
        ...(this.acl ? { ACL: this.acl } : {}),
      })
    )
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: fromPath,
      })
    )

    return {
      storageProvider: this.providerName,
      storagePath: toPath,
      storageUrl: this.getUrl(toPath),
    }
  }

  /**
   * Pick an unclaimed object key: compose the friendly key, verify it is
   * free (one HeadObject), and retry with a fresh suffix on collision.
   * After three straight collisions (pathological — a same-named file
   * avalanche) fall back to a full-entropy UUID suffix, which cannot
   * realistically collide.
   */
  private async availableObjectKey(options: UploadFileOptions): Promise<string> {
    const scope = options.location ?? options.collection
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = buildObjectKey(this.pathPrefix, scope, options.filename, randomSuffix())
      if (!(await this.exists(candidate))) return candidate
    }
    return buildObjectKey(this.pathPrefix, scope, options.filename, uuidv4())
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
        })
      )
      return true
    } catch (err: unknown) {
      const name = (err as { name?: string }).name
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return false
      }
      throw err
    }
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
 *   `[pathPrefix/]<location|collection>/<filename>-<suffix>.<ext>`
 *
 * Image variants (thumbnail / card / etc.) are written as siblings of the
 * original under the same prefix, e.g.:
 *   `<...>-<filename>-<variantName>.<format>`
 *
 * @example AWS S3 with explicit keys
 * ```ts
 * import { s3StorageProvider } from '@byline/storage-s3'
 *
 * storage: s3StorageProvider({
 *   bucket: 'my-cms-bucket',
 *   region: 'eu-west-1',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   publicUrl: 'https://cdn.example.com',
 *   cacheControl: 'public, max-age=31536000, immutable',
 * })
 * ```
 *
 * @example AWS S3 with the default credential chain (IAM role / SSO / env)
 * ```ts
 * storage: s3StorageProvider({
 *   bucket: 'my-cms-bucket',
 *   region: 'eu-west-1',
 *   // accessKeyId / secretAccessKey omitted — the AWS SDK resolves
 *   // credentials via its default provider chain.
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
 *
 * @example Per-upload metadata + retry tuning
 * ```ts
 * storage: s3StorageProvider({
 *   bucket: 'my-cms-bucket',
 *   region: 'eu-west-1',
 *   metadata: (opts) => ({ collection: opts.collection ?? 'uploads' }),
 *   clientConfig: { maxAttempts: 5, retryMode: 'adaptive' },
 * })
 * ```
 */
export function s3StorageProvider(config: S3StorageConfig): IStorageProvider {
  return new S3StorageProvider(config)
}
