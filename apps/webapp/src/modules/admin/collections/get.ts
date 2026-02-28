/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getCollectionSchemasForPath, getServerConfig } from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'
import { serialise } from './utils'

// ---------------------------------------------------------------------------
// Get document (current version, with optional published-version metadata)
// ---------------------------------------------------------------------------

const getDocumentFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; id: string; locale?: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, id, locale } = data
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db

    const rawDocument = await db.queries.documents.getDocumentById({
      collection_id: config.collection.id,
      document_id: id,
      locale: locale ?? 'en',
    })

    if (!rawDocument) throw new Error('Document not found')

    const serialised = serialise(rawDocument)

    // When fetching all locales the storage layer returns localized fields as
    // locale-keyed objects (e.g. { en: '...', fr: '...' }) which do not
    // conform to the typed per-locale Zod schema — skip validation in that case.
    const document =
      locale === 'all'
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
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const rawDocument = await db.queries.documents.getDocumentByVersion({
      document_version_id: versionId,
      locale: resolvedLocale,
    })

    if (!rawDocument) throw new Error('Document version not found')

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
 */
export async function getCollectionDocument(collection: string, id: string, locale?: string) {
  try {
    return await getDocumentFn({ data: { collection, id, locale } })
  } catch (err: any) {
    if (err?.message === 'Document not found') return null
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
  } catch (err: any) {
    if (err?.message === 'Document version not found') return null
    throw err
  }
}
