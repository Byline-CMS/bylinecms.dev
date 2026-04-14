/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  BylineError,
  ERR_NOT_FOUND,
  ErrorCodes,
  getCollectionSchemasForPath,
  getLogger,
  getServerConfig,
  populateDocuments,
} from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'
import { serialise } from './utils'

// ---------------------------------------------------------------------------
// Get document (current version, with optional published-version metadata)
// ---------------------------------------------------------------------------

const getDocumentFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: { collection: string; id: string; locale?: string; depth?: number }) => input
  )
  .handler(async ({ data }) => {
    const { collection: path, id, locale, depth } = data
    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const serverConfig = getServerConfig()
    const db = serverConfig.db

    const rawDocument = await db.queries.documents.getDocumentById({
      collection_id: config.collection.id,
      document_id: id,
      locale: locale ?? 'en',
    })

    if (!rawDocument) {
      throw ERR_NOT_FOUND({
        message: 'Document not found',
        details: { documentId: id, collectionPath: path },
      }).log(logger)
    }

    // Populate relation leaves when the caller requested a depth. Runs on
    // the raw storage shape (before serialisation / Zod parse) so the
    // populate walker sees the expected `{document_id, fields}` structure.
    // Uses the top-level `'*'` spec — walk every relation with the full
    // document projection at every depth — which gives the admin API
    // preview (the sole caller with depth > 0 today) the whole tree the
    // reader expects to see. `populate: true` would only fetch identity
    // fields, which is not useful for a debug/preview view.
    const populateRequested = typeof depth === 'number' && depth > 0
    if (populateRequested) {
      await populateDocuments({
        db,
        collections: serverConfig.collections,
        collectionId: config.collection.id,
        documents: [rawDocument as Record<string, any>],
        populate: '*',
        // populate: true,
        depth,
        locale: locale ?? 'en',
      })
    }

    const serialised = serialise(rawDocument)

    // Skip the strict per-locale Zod parse when:
    //   - locale === 'all' (fields are locale-keyed objects, not per-locale values)
    //   - populated (the tree now contains nested populated documents that
    //     don't match the raw relation-ref shape the schema expects)
    const document =
      locale === 'all' || populateRequested
        ? (serialised as Record<string, any>)
        : (() => {
            const { get } = getCollectionSchemasForPath(path)
            return get.parse(serialised)
          })()

    // If the current version is not published, check whether a separate
    // published version exists so the UI can show a "published is live" badge.
    let publishedVersion: Record<string, any> | null = null

    if ((document as any).status !== 'published') {
      const pv = await db.queries.documents.getPublishedVersion({
        collection_id: config.collection.id,
        document_id: id,
      })
      publishedVersion = pv ? serialise(pv) : null
    }

    // Merge published-version metadata into the document. This is null when
    // the current version is already published.
    return { ...(document as Record<string, any>), _publishedVersion: publishedVersion }
  })

// ---------------------------------------------------------------------------
// Get document by specific version ID (for history / diff views)
// ---------------------------------------------------------------------------

const getDocumentByVersionFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; versionId: string; locale?: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, versionId, locale } = data
    const resolvedLocale = locale ?? 'all'

    // ensureCollection validates the path is known — not strictly needed for a
    // version fetch, but keeps auth/404 behaviour consistent.
    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const db = getServerConfig().db
    const rawDocument = await db.queries.documents.getDocumentByVersion({
      document_version_id: versionId,
      locale: resolvedLocale,
    })

    if (!rawDocument) {
      throw ERR_NOT_FOUND({
        message: 'Document version not found',
        details: { documentVersionId: versionId, collectionPath: path },
      }).log(logger)
    }

    const serialised = serialise(rawDocument)

    // When fetching all locales the storage layer returns localized fields as
    // locale-keyed objects — skip Zod validation in that case (same rationale
    // as getDocumentFn). For a specific locale, parse for runtime safety.
    if (resolvedLocale === 'all') {
      return serialised as Record<string, any>
    }

    // Parse through the same Zod schema used by getDocumentFn so that key
    // ordering and datetime formats are normalised identically on both sides
    // of the diff — otherwise identical content renders as changed.
    const { get } = getCollectionSchemasForPath(path)
    return get.parse(serialised) as Record<string, any>
  })

/**
 * Fetch a single document by ID. Returns `null` when the document is not found
 * so callers can degrade gracefully (e.g. `notFound()`).
 *
 * When `depth > 0` is supplied, relation leaves are populated via
 * `populateDocuments` before the response is returned — this is the hook
 * that powers the admin API-preview Depth selector. The returned tree
 * then contains nested raw documents at relation sites instead of bare
 * `{target_document_id, target_collection_id}` refs.
 */
export async function getCollectionDocument(
  collection: string,
  id: string,
  locale?: string,
  depth?: number
) {
  try {
    return await getDocumentFn({ data: { collection, id, locale, depth } })
  } catch (err) {
    if (err instanceof BylineError && err.code === ErrorCodes.NOT_FOUND) return null
    throw err
  }
}

/**
 * Fetch a specific historical version of a document. Returns `null` when the
 * version is not found.
 */
export async function getCollectionDocumentVersion(
  collection: string,
  _documentId: string,
  versionId: string,
  locale?: string
) {
  try {
    return await getDocumentByVersionFn({
      data: { collection, versionId, locale },
    })
  } catch (err) {
    if (err instanceof BylineError && err.code === ErrorCodes.NOT_FOUND) return null
    throw err
  }
}
