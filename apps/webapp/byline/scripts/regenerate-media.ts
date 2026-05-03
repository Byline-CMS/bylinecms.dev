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
 *   pnpm tsx --env-file=.env byline/scripts/regenerate-media.ts
 *
 * The script orchestrates the same two-step flow the admin UI uses
 * for an existing document — upload (createDocument: false) followed by
 * a document update — but as a single "one-shot" Client SDK pass per
 * media item. Variants and the original written under fresh paths;
 * the previous original + variant files are deleted once the document
 * has been re-pointed at the new value.
 *
 * Bypass-MIME images (SVG / GIF) are passed through untouched — Sharp
 * does not produce variants for them, so the only effect is a new
 * storagePath on a re-stored copy.
 *
 * Currently requires the local storage provider — pulls bytes back via
 * the provider's `uploadDir`. An S3-capable variant would add a
 * `download(storagePath)` to `IStorageProvider` and route through that.
 */

import 'dotenv/config'
import '../server.config.js'

import fs from 'node:fs'
import path from 'node:path'

import { createSuperAdminContext } from '@byline/auth'
import { createBylineClient } from '@byline/client'
import {
  type FieldUploadContext,
  getCollectionDefinition,
  getServerConfig,
  type StoredFileValue,
} from '@byline/core'
import { uploadField as coreUploadField } from '@byline/core/services'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/storage-local'

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
  // either skip or re-visit rows.
  const allDocs: { id: string; path: string; fields: Record<string, any> }[] = []
  const pageSize = 100
  for (let page = 1; ; page++) {
    const result = await handle.find({
      page,
      pageSize,
      status: 'any',
      _bypassBeforeRead: true,
    })
    for (const d of result.docs) {
      allDocs.push({ id: d.id, path: d.path, fields: d.fields as Record<string, any> })
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
      generateVariants: async ({ buffer, mimeType, storedFile, storage, upload, logger }) => {
        const dir = (storage as { uploadDir?: unknown }).uploadDir as string
        const absoluteOriginalPath = path.join(dir, storedFile.storagePath)
        return generateImageVariants(
          buffer,
          mimeType,
          absoluteOriginalPath,
          dir,
          upload.sizes ?? [],
          logger
        )
      },
    },
  }

  let processed = 0
  let skipped = 0

  for (const doc of allDocs) {
    const image = doc.fields[FIELD_NAME] as StoredFileValue | undefined | null
    if (image == null || !image.storagePath) {
      console.log(`  - skip ${doc.id} (${doc.path}) — no image value`)
      skipped += 1
      continue
    }

    const sourceAbsolutePath = path.join(uploadDir, image.storagePath)
    let buffer: Buffer
    try {
      buffer = await fs.promises.readFile(sourceAbsolutePath)
    } catch (err) {
      console.error(
        `  ! skip ${doc.id} (${doc.path}) — failed to read original at ${sourceAbsolutePath}:`,
        err
      )
      skipped += 1
      continue
    }

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

    const nextFields = { ...doc.fields, [FIELD_NAME]: uploadResult.storedFile }
    await handle.update(doc.id, nextFields)

    // Best-effort orphan cleanup. Failures are non-fatal — the new
    // value is already persisted, the doc is consistent, the unused
    // bytes are just dead weight on disk.
    const orphans: string[] = [
      image.storagePath,
      ...(image.variants ?? []).map((v) => v.storagePath).filter((p): p is string => Boolean(p)),
    ]
    for (const orphan of orphans) {
      try {
        await storage.delete(orphan)
      } catch (err) {
        console.warn(`    ! failed to delete orphan ${orphan}:`, err)
      }
    }

    const variantSummary =
      uploadResult.storedFile.variants?.map((v) => `${v.name}:${v.format ?? '?'}`).join(', ') ??
      '(none)'
    console.log(
      `  - ${doc.id} (${doc.path}) → ${uploadResult.storedFile.storagePath} [${variantSummary}]`
    )
    processed += 1
  }

  console.log(
    `regenerate-media: done. processed=${processed}, skipped=${skipped}, total=${allDocs.length}.`
  )
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('regenerate-media failed:', err)
    process.exit(1)
  })
