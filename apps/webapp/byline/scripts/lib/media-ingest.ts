/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown image → `media` collection ingestion.
 *
 * The mdast → Lexical converter is pure and synchronous, but resolving an
 * image means storage writes and DB round-trips. So image ingestion runs as
 * a pre-pass (mirroring the `sourcePath → publicPath` pre-pass that backs
 * link rewriting): collect every image URL in a document, ensure each one
 * exists in `media`, and hand the converter a plain lookup map.
 *
 * Dedupe is keyed on the media document `path`, derived from the image's
 * filename. A second import of the same filename reuses the existing media
 * document rather than uploading again — which also means an image whose
 * *contents* changed under the same filename is NOT re-ingested. Rename the
 * source file to force a fresh ingest. This is deliberate: a Byline delete is
 * soft and leaves the path reserved, so re-uploading in place would need the
 * same revive dance `--force` does for docs.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'

import type { RequestContext } from '@byline/auth'
import type { CollectionHandle, createBylineClient } from '@byline/client'
import {
  type CollectionDefinition,
  type FieldUploadContext,
  getCollectionDefinition,
  getServerConfig,
  normalizeCollectionHook,
  resolveHooks,
  type StoredFileValue,
  slugify,
} from '@byline/core'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/core/image'
import { uploadField as coreUploadField } from '@byline/core/services'
import type { Content, Image, Root } from 'mdast'

import { type ImportDocsForceDatabase, replaceDeletedDocumentAtPath } from './import-docs-force.js'

const MEDIA_COLLECTION = 'media'
const MEDIA_UPLOAD_FIELD = 'image'
const MEDIA_IMPORT_STATUS = 'published'

/**
 * The variant an inline image at `position: 'full'` renders from. Mirrors
 * `variantFor()` in the inline-image extension
 * (`packages/richtext-lexical/src/field/extensions/inline-image/utils.ts`) —
 * every image the importer emits is full-width.
 */
const FULL_POSITION_VARIANT = 'tablet'

/** Extension → MIME, limited to what the `media` collection accepts. */
const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

/**
 * One resolved image: the relation envelope the inline-image node carries,
 * plus the render state (`src` and intrinsic dimensions) it falls back to
 * when server-side populate has not run.
 */
export interface ResolvedImage {
  targetDocumentId: string
  targetCollectionId: string
  targetCollectionPath: string
  src: string
  width?: number
  height?: number
}

/** Keyed by the raw URL as written in the markdown source. */
export type ImageMap = Map<string, ResolvedImage>

export interface MediaIngestWarning {
  kind: 'unsupported-image' | 'missing-image' | 'fetch-failed' | 'ingest-failed'
  detail: string
}

export interface IngestResult {
  images: ImageMap
  warnings: MediaIngestWarning[]
  /** Media documents newly uploaded by this run (not counting reuses). */
  created: number
  /** Existing media documents matched by path and reused. */
  reused: number
  /** Soft-deleted media documents reclaimed under `--force`. */
  revived: number
}

/**
 * Collect every distinct image URL in a document, block-level and inline.
 * Order is source order; duplicates within one file collapse to one entry.
 */
export function collectImageUrls(root: Root): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const visit = (node: Content | Root): void => {
    if ((node as { type: string }).type === 'image') {
      const url = (node as Image).url
      if (url && !seen.has(url)) {
        seen.add(url)
        urls.push(url)
      }
    }
    const children = (node as { children?: Content[] }).children
    if (children) for (const child of children) visit(child)
  }
  visit(root)
  return urls
}

function isRemote(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/**
 * Media document path for an image URL: the filename, without extension,
 * slugified. `./images/byline-deployment-1-integrated.svg` and
 * `https://example.com/a/byline-deployment-1-integrated.svg` both key to
 * `byline-deployment-1-integrated` — deliberately, so moving an image
 * between directories does not orphan its media document.
 */
export function mediaPathForUrl(url: string, slugify: (value: string) => string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url
  const name = basename(withoutQuery, extname(withoutQuery))
  const slug = slugify(name)
  // A filename that slugifies away entirely (e.g. all punctuation) still
  // needs a stable, collision-free path.
  if (slug.length > 0) return slug
  return `image-${createHash('sha1').update(withoutQuery).digest('hex').slice(0, 12)}`
}

function mimeTypeForUrl(url: string): string | null {
  const withoutQuery = url.split(/[?#]/)[0] ?? url
  return MIME_TYPES[extname(withoutQuery).toLowerCase()] ?? null
}

/**
 * Accept a served `Content-Type` only when it names an image type the
 * `media` collection actually allows — the header is attacker-controllable
 * in the general case, and `uploadField` validates against `upload.mimeTypes`
 * regardless.
 */
export function mimeTypeFromContentType(contentType: string | null): string | null {
  if (contentType == null) return null
  return Object.values(MIME_TYPES).includes(contentType) ? contentType : null
}

/** Canonical extension for a MIME type, for naming extension-less downloads. */
function extensionForMimeType(mimeType: string): string {
  const match = Object.entries(MIME_TYPES).find(([, value]) => value === mimeType)
  return match?.[0] ?? ''
}

/** Give up on an unresponsive host rather than stalling the whole import. */
const REMOTE_FETCH_TIMEOUT_MS = 30_000

/**
 * Read an image's bytes. Local URLs resolve relative to the markdown file
 * that referenced them; remote URLs are downloaded into a temp directory the
 * caller cleans up.
 *
 * `contentType` is only ever set for remote reads, where it is the fallback
 * for URLs that carry no usable file extension.
 */
async function readImageBytes(
  url: string,
  sourceFilePath: string,
  tempDir: () => Promise<string>
): Promise<{ buffer: Buffer; contentType: string | null }> {
  if (!isRemote(url)) {
    return { buffer: await readFile(resolve(dirname(sourceFilePath), url)), contentType: null }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  // Land it on disk before ingesting so a failed upload leaves something
  // inspectable, and so behaviour matches the local-file path.
  const scratch = join(await tempDir(), basename(url.split(/[?#]/)[0] ?? 'download'))
  await writeFile(scratch, buffer)
  return {
    buffer: await readFile(scratch),
    // `image/png; charset=…` → `image/png`
    contentType: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null,
  }
}

/**
 * Pick the URL an inline image at `position: 'full'` should render from.
 * SVGs and variant-less images use the original; everything else prefers
 * the variant the extension would request.
 */
function srcForStoredFile(image: StoredFileValue): ResolvedImage['src'] {
  if (image.mimeType === 'image/svg+xml' || !image.variants?.length) {
    return image.storageUrl ?? ''
  }
  const match = image.variants.find((variant) => variant.name === FULL_POSITION_VARIANT)
  return match?.storageUrl ?? image.storageUrl ?? ''
}

function dimensionsForStoredFile(image: StoredFileValue): { width?: number; height?: number } {
  return { width: image.imageWidth, height: image.imageHeight }
}

/** `ERR_PATH_CONFLICT` from the document-lifecycle path write. */
function isPathConflict(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === 'ERR_PATH_CONFLICT'
  )
}

/**
 * Remove an already-stored file (and any variants) after the document write
 * that would have owned it failed. Best effort: a cleanup failure must not
 * mask the original error, so it is logged and swallowed.
 */
async function deleteStoredFileBestEffort(
  storage: NonNullable<ReturnType<typeof getServerConfig>['storage']>,
  storedFile: StoredFileValue
): Promise<void> {
  const paths = [
    storedFile.storagePath,
    ...(storedFile.variants ?? [])
      .map((variant) => variant.storagePath)
      .filter((value): value is string => Boolean(value)),
  ]
  for (const storagePath of paths) {
    try {
      await storage.delete(storagePath)
    } catch (err) {
      console.warn(
        `  ! media-ingest: could not remove orphaned '${storagePath}': ` +
          `${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

function requireMediaDefinition(): CollectionDefinition {
  const definition = getCollectionDefinition(MEDIA_COLLECTION)
  if (definition == null) {
    throw new Error(`media-ingest: collection '${MEDIA_COLLECTION}' is not registered`)
  }
  const field = definition.fields.find((f) => f.name === MEDIA_UPLOAD_FIELD)
  if (field == null || (field.type !== 'image' && field.type !== 'file') || field.upload == null) {
    throw new Error(
      `media-ingest: '${MEDIA_COLLECTION}.${MEDIA_UPLOAD_FIELD}' is not an upload-capable field`
    )
  }
  return definition
}

export interface IngestImagesArgs {
  root: Root
  sourceFilePath: string
  client: ReturnType<typeof createBylineClient>
  /** The actor uploads run as — the client keeps its own copy private. */
  requestContext: RequestContext
  /** Not used for writes under `--dry-run`; existing media are still resolved. */
  dryRun: boolean
  /**
   * `--force`: revive a soft-deleted media document occupying the target
   * path instead of colliding with it. Same meaning the flag carries for
   * docs — see `replaceDeletedDocumentAtPath`.
   */
  force: boolean
  /** Raw pool backing the `--force` revive. */
  pool: ImportDocsForceDatabase
}

/**
 * Walk a revived media document forward to `published`. `update` resets a
 * document to the workflow's default status, and the workflow only permits
 * ±1 step transitions, so this steps rather than jumping.
 */
async function walkToPublished(
  handle: CollectionHandle,
  definition: CollectionDefinition,
  documentId: string
): Promise<void> {
  const statuses = definition.workflow?.statuses ?? []
  const from = statuses.findIndex((s) => s.name === (statuses[0]?.name ?? 'draft'))
  const to = statuses.findIndex((s) => s.name === MEDIA_IMPORT_STATUS)
  if (from === -1 || to === -1 || to <= from) return
  for (let i = from + 1; i <= to; i++) {
    await handle.changeStatus(documentId, statuses[i].name)
  }
}

/**
 * Ensure every image referenced by `root` exists in the `media` collection,
 * and return the URL → relation-envelope map the converter needs.
 *
 * Failures are per-image and non-fatal: an image that cannot be read,
 * fetched, or ingested is reported as a warning and left out of the map, at
 * which point the converter drops it exactly as it did before images were
 * supported. One bad image never fails a document import.
 */
export async function ingestImages({
  root,
  sourceFilePath,
  client,
  requestContext,
  dryRun,
  force,
  pool,
}: IngestImagesArgs): Promise<IngestResult> {
  const urls = collectImageUrls(root)
  const result: IngestResult = {
    images: new Map(),
    warnings: [],
    created: 0,
    reused: 0,
    revived: 0,
  }
  if (urls.length === 0) return result

  const config = getServerConfig()
  const storage = config.storage
  if (storage == null) {
    throw new Error(
      'media-ingest: no storage provider configured on ServerConfig. ' +
        'Set storage in byline/server.config.ts.'
    )
  }
  const definition = requireMediaDefinition()
  const handle = client.collection(MEDIA_COLLECTION)
  const { id: collectionId, version: collectionVersion } =
    await client.resolveCollectionRecord(MEDIA_COLLECTION)

  let scratchDir: string | null = null
  const tempDir = async (): Promise<string> => {
    if (scratchDir == null) scratchDir = await mkdtemp(join(tmpdir(), 'byline-import-media-'))
    return scratchDir
  }

  try {
    for (const url of urls) {
      try {
        // A local file has only its extension to go on, so an unknown one is
        // decided here. A remote URL may carry no extension at all (GitHub
        // attachment URLs, CDN hashes) — defer to the served Content-Type
        // after the download rather than skipping it unseen.
        const mimeFromUrl = mimeTypeForUrl(url)
        if (mimeFromUrl == null && !isRemote(url)) {
          result.warnings.push({
            kind: 'unsupported-image',
            detail: `${url} — no known image extension; leaving it out of '${MEDIA_COLLECTION}'`,
          })
          continue
        }

        const mediaPath = mediaPathForUrl(url, (value) =>
          slugify(value, { locale: client.defaultLocale, collectionPath: MEDIA_COLLECTION })
        )

        // Dedupe: an existing media document at this path wins, always.
        const existing = await handle.findByPath(mediaPath, {
          status: 'any',
          _bypassBeforeRead: true,
        })
        if (existing) {
          const image = existing.fields?.[MEDIA_UPLOAD_FIELD] as StoredFileValue | undefined
          if (image?.storageUrl) {
            result.images.set(url, {
              targetDocumentId: existing.id,
              targetCollectionId: collectionId,
              targetCollectionPath: MEDIA_COLLECTION,
              src: srcForStoredFile(image),
              ...dimensionsForStoredFile(image),
            })
            result.reused += 1
          } else {
            result.warnings.push({
              kind: 'ingest-failed',
              detail: `${url} — media document '${mediaPath}' exists but carries no stored file`,
            })
          }
          continue
        }

        if (dryRun) {
          result.warnings.push({
            kind: 'missing-image',
            detail: `${url} — would ingest as '${mediaPath}' (dry-run: not uploaded, image dropped)`,
          })
          continue
        }

        const { buffer, contentType } = await readImageBytes(url, sourceFilePath, tempDir)
        const mimeType = mimeFromUrl ?? mimeTypeFromContentType(contentType)
        if (mimeType == null) {
          result.warnings.push({
            kind: 'unsupported-image',
            detail:
              `${url} — no known image extension, and served Content-Type ` +
              `'${contentType ?? 'none'}' is not accepted by '${MEDIA_COLLECTION}'`,
          })
          continue
        }

        // An extension-less download still needs a sane stored filename.
        const rawName = basename((url.split(/[?#]/)[0] ?? url).trim())
        const originalFilename =
          extname(rawName).length > 0 ? rawName : `${rawName}${extensionForMimeType(mimeType)}`

        const uploadCtx: FieldUploadContext = {
          db: config.db,
          definition,
          collectionId,
          collectionVersion,
          collectionPath: MEDIA_COLLECTION,
          fieldName: MEDIA_UPLOAD_FIELD,
          storage,
          logger: client.logger,
          defaultLocale: config.i18n.content.defaultLocale,
          slugifier: config.slugifier,
          requestContext,
          imageProcessor: {
            extractMeta: extractImageMeta,
            isBypassMimeType,
            generateVariants: ({ buffer: b, mimeType: m, storedFile, storage, upload, logger }) =>
              generateImageVariants(b, m, storedFile, storage, upload.sizes ?? [], logger),
          },
        }

        // Two steps rather than `shouldCreateDocument: true`, because the
        // media collection declares no `useAsPath` — the document would get
        // a UUID path and the filename dedupe key above would never match.
        const { storedFile } = await coreUploadField(uploadCtx, {
          buffer,
          originalFilename,
          mimeType,
          fileSize: buffer.byteLength,
          shouldCreateDocument: false,
        })

        const fields = { title: originalFilename, [MEDIA_UPLOAD_FIELD]: storedFile }

        // The bytes are in storage now, but `shouldCreateDocument: false`
        // means core has no document write to roll back against — cleanup on
        // a failed placement is ours to do, or we leak an orphaned object
        // into S3 / the upload dir on every retry.
        let documentId: string
        try {
          // A soft-deleted media document still owns its path row while
          // `findByPath` (which reads the deleted-filtering view) reports
          // nothing — so the dedupe check above finds nothing and a plain
          // create would collide. Under `--force`, revive it instead, exactly
          // as the docs import does for its own collection.
          const revived = force
            ? await replaceDeletedDocumentAtPath(
                pool,
                { collectionId, locale: client.defaultLocale, path: mediaPath },
                async (deletedId) => {
                  await handle.update(deletedId, fields, { locale: client.defaultLocale })
                  await walkToPublished(handle, definition, deletedId)
                  return deletedId
                },
                async (deletedId) => {
                  const hooks = await resolveHooks(definition)
                  for (const hook of normalizeCollectionHook(hooks?.afterDelete)) {
                    await hook({
                      documentId: deletedId,
                      collectionPath: MEDIA_COLLECTION,
                      path: mediaPath,
                    })
                  }
                }
              )
            : null

          if (revived != null) {
            documentId = revived.value
            result.revived += 1
          } else {
            const created = await handle.create(fields, {
              path: mediaPath,
              status: MEDIA_IMPORT_STATUS,
            })
            documentId = created.documentId
            result.created += 1
          }
        } catch (err) {
          await deleteStoredFileBestEffort(storage, storedFile)
          if (isPathConflict(err)) {
            throw new Error(
              `media path '${mediaPath}' is reserved by a deleted media document. ` +
                'Re-run with --force to reclaim it, rename the source image, or purge ' +
                'that document.'
            )
          }
          throw err
        }

        result.images.set(url, {
          targetDocumentId: documentId,
          targetCollectionId: collectionId,
          targetCollectionPath: MEDIA_COLLECTION,
          src: srcForStoredFile(storedFile),
          ...dimensionsForStoredFile(storedFile),
        })
      } catch (err) {
        result.warnings.push({
          kind: isRemote(url) ? 'fetch-failed' : 'ingest-failed',
          detail: `${url} — ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  } finally {
    if (scratchDir != null) await rm(scratchDir, { recursive: true, force: true })
  }

  return result
}
