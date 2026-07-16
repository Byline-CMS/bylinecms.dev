/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Regenerate media — example Byline script.
 *
 * Iterates the `media` collection, re-uploads each original through the
 * core upload service so Sharp regenerates the variant set declared in
 * the current schema, then updates the document with the fresh
 * `storedFile` via `@byline/client`.
 *
 * Run after changing the variant set (e.g. switching `format: 'webp'`
 * to `'avif'` in `byline/collections/media/schema.ts`) to bring existing
 * assets in line with the new pipeline:
 *
 *   pnpm tsx byline/scripts/regenerate-media.ts
 *
 * The script orchestrates the same two-step flow the admin UI uses
 * for an existing document — upload (createDocument: false) followed by
 * a document update — but as a single "one-shot" Client SDK pass per
 * media item. Variants and the original are written under fresh paths.
 * Previous files are retained because immutable historical versions — or an
 * older published version while the current version is draft — may still
 * reference them. Storage reclamation requires a separate reference-aware
 * garbage collector.
 *
 * Bypass-MIME images (SVG / GIF) are passed through untouched — Sharp
 * does not produce variants for them, so the only effect is a new
 * storagePath on a re-stored copy.
 *
 * Status preservation: `updateDocument` stamps new versions with the
 * workflow's default status (`'draft'` for media). The script wraps that
 * update and a direct restoration of the captured status in one database
 * transaction. This is a deliberate maintenance-only use of adapter
 * commands: an archived item is never temporarily published, and callers
 * cannot observe the intermediate draft. Run without concurrent editorial
 * writes to the media collection.
 *
 * Safety: the generated variant names must exactly match the current schema
 * before the document is changed. A failed upload/update is compensated by
 * deleting the newly-written files, failures are collected per document, and
 * the process exits non-zero after attempting the remaining items.
 *
 * Currently requires the local storage provider — pulls bytes back via
 * the provider's `uploadDir`. Variant generation itself is provider-
 * agnostic; the local-only piece is reading the *original* bytes back
 * from disk. An S3-capable variant would add a `download(storagePath)`
 * primitive to `IStorageProvider` and route through that.
 */

import '../load-env.js'
import '../server.config.js'

import fs from 'node:fs'
import path from 'node:path'

import { createSuperAdminContext } from '@byline/auth'
import { createBylineClient } from '@byline/client'
import { type FieldUploadContext, getCollectionDefinition, getServerConfig } from '@byline/core'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/core/image'
import { uploadField as coreUploadField } from '@byline/core/services'
import type { MediaFields } from '@byline/generated-types'

import {
  assertCompleteVariantSet,
  replaceMediaVersionPreservingStatus,
  storedFilePaths,
} from './regenerate-media-operation.js'

const COLLECTION_PATH = 'media'
const FIELD_NAME = 'image'

async function run(): Promise<void> {
  const config = getServerConfig()
  const definition = getCollectionDefinition(COLLECTION_PATH)
  if (!definition) {
    throw new Error(`Collection '${COLLECTION_PATH}' is not registered.`)
  }

  const storage = config.storage
  if (!storage) {
    throw new Error(
      `regenerate-media: no storage provider configured on ServerConfig. ` +
        `Set storage in byline/server.config.ts.`
    )
  }
  // Local-only escape hatch — we read bytes back from disk via uploadDir.
  // Lift this when IStorageProvider grows a download primitive.
  const uploadDir = (storage as { uploadDir?: unknown }).uploadDir
  if (typeof uploadDir !== 'string') {
    throw new Error(
      'regenerate-media currently requires the local storage provider ' +
        '(no remote download primitive on IStorageProvider yet).'
    )
  }

  const requestContext = createSuperAdminContext({ id: 'regenerate-media-script' })
  const client = createBylineClient({ config, requestContext })

  const { id: collectionId, version: collectionVersion } =
    await client.resolveCollectionRecord(COLLECTION_PATH)

  const handle = client.collection(COLLECTION_PATH)

  // Snapshot the full set up-front. Each update bumps `updated_at` and
  // reorders the default sort, so paging through a moving window would
  // either skip or re-visit rows. Capture `status` so we can restore
  // each doc to its original workflow slot inside the replacement
  // transaction.
  const allDocs: {
    id: string
    path: string
    status: string
    fields: MediaFields
  }[] = []
  const pageSize = 100
  for (let page = 1; ; page++) {
    const result = await handle.find({
      page,
      pageSize,
      status: 'any',
      _bypassBeforeRead: true,
    })
    for (const d of result.docs) {
      allDocs.push({
        id: d.id,
        path: d.path,
        status: d.status,
        fields: d.fields,
      })
    }
    if (result.docs.length < pageSize) break
  }

  console.log(`regenerate-media: found ${allDocs.length} document(s) in '${COLLECTION_PATH}'.`)

  const baseUploadCtx: Omit<FieldUploadContext, 'requestContext'> = {
    db: config.db,
    definition,
    collectionId,
    collectionVersion,
    collectionPath: COLLECTION_PATH,
    fieldName: FIELD_NAME,
    storage,
    logger: client.logger,
    defaultLocale: config.i18n.content.defaultLocale,
    slugifier: config.slugifier,
    imageProcessor: {
      extractMeta: extractImageMeta,
      isBypassMimeType,
      generateVariants: ({ buffer, mimeType, storedFile, storage, upload, logger }) =>
        generateImageVariants(buffer, mimeType, storedFile, storage, upload.sizes ?? [], logger),
    },
  }

  const imageField = definition.fields.find((field) => field.name === FIELD_NAME)
  if (imageField == null || (imageField.type !== 'image' && imageField.type !== 'file')) {
    throw new Error(
      `regenerate-media: '${COLLECTION_PATH}.${FIELD_NAME}' is not an image/file field.`
    )
  }
  if (imageField.upload == null) {
    throw new Error(
      `regenerate-media: '${COLLECTION_PATH}.${FIELD_NAME}' has no upload configuration.`
    )
  }

  let processed = 0
  let skipped = 0
  const failures: Error[] = []

  for (const doc of allDocs) {
    const image = doc.fields[FIELD_NAME]
    if (image == null || !image.storagePath) {
      console.log(`  - skip ${doc.id} (${doc.path}) — no image value`)
      skipped += 1
      continue
    }

    const oldPaths = storedFilePaths(image)
    const sourceAbsolutePath = path.join(uploadDir, image.storagePath)
    let buffer: Buffer
    try {
      buffer = await fs.promises.readFile(sourceAbsolutePath)
    } catch (err) {
      console.error(
        `  ! fail ${doc.id} (${doc.path}) — failed to read original at ${sourceAbsolutePath}:`,
        err
      )
      failures.push(asDocumentError(doc.id, doc.path, err))
      continue
    }

    let freshPaths = new Set<string>()
    try {
      const uploadResult = await coreUploadField(
        { ...baseUploadCtx, requestContext },
        {
          buffer,
          originalFilename: image.originalFilename || image.filename,
          mimeType: image.mimeType,
          fileSize: buffer.byteLength,
          shouldCreateDocument: false,
        }
      )
      freshPaths = storedFilePaths(uploadResult.storedFile)

      const expectedVariantNames = isBypassMimeType(image.mimeType)
        ? []
        : (imageField.upload.sizes ?? []).map((size) => size.name)
      assertCompleteVariantSet(uploadResult.storedFile, expectedVariantNames)

      const collisions = [...freshPaths].filter((storagePath) => oldPaths.has(storagePath))
      if (collisions.length > 0) {
        throw new Error(
          `regenerate-media: upload hooks reused existing storage path(s): ${collisions.join(', ')}. ` +
            'Fresh paths are required for an atomic replacement.'
        )
      }

      const nextFields = { ...doc.fields, [FIELD_NAME]: uploadResult.storedFile }
      await replaceMediaVersionPreservingStatus({
        db: config.db,
        definition,
        collectionId,
        handle,
        documentId: doc.id,
        fields: nextFields,
        targetStatus: doc.status,
      })

      const variantSummary =
        uploadResult.storedFile.variants?.map((v) => `${v.name}:${v.format ?? '?'}`).join(', ') ??
        '(none)'
      console.log(
        `  - ${doc.id} (${doc.path}) → ${uploadResult.storedFile.storagePath} [${variantSummary}]`
      )
      processed += 1
    } catch (err) {
      // The document transaction did not commit. Remove every fresh path we
      // know about, but never delete a path that belonged to the old value — a
      // deterministic beforeStore hook may already have overwritten it.
      const rollbackPaths = new Set(
        [...freshPaths].filter((storagePath) => !oldPaths.has(storagePath))
      )
      const cleanupErrors = await deletePathsBestEffort(storage, rollbackPaths)
      const failure = asDocumentError(doc.id, doc.path, err)
      failures.push(
        cleanupErrors.length === 0
          ? failure
          : new AggregateError(
              [failure, ...cleanupErrors],
              `regenerate-media: operation and rollback cleanup failed for '${doc.path}'`
            )
      )
      console.error(`  ! fail ${doc.id} (${doc.path}):`, err)
    }
  }

  console.log(
    `regenerate-media: done. processed=${processed}, skipped=${skipped}, ` +
      `failed=${failures.length}, total=${allDocs.length}.`
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, `regenerate-media: ${failures.length} document(s) failed`)
  }
}

async function deletePathsBestEffort(
  storage: NonNullable<ReturnType<typeof getServerConfig>['storage']>,
  storagePaths: Iterable<string>
): Promise<Error[]> {
  const errors: Error[] = []
  for (const storagePath of storagePaths) {
    try {
      await storage.delete(storagePath)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      errors.push(error)
      console.warn(`    ! failed to delete ${storagePath}:`, error)
    }
  }
  return errors
}

function asDocumentError(documentId: string, documentPath: string, err: unknown): Error {
  return new Error(`regenerate-media: '${documentPath}' (${documentId}) failed`, {
    cause: err,
  })
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('regenerate-media failed:', err)
    process.exit(1)
  })
