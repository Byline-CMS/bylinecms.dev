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
  buildRelationSummaryPopulateMap,
  ERR_NOT_FOUND,
  ErrorCodes,
  getCollectionAdminConfig,
  getCollectionDefinition,
  getCollectionSchemasForPath,
  getLogger,
  getServerConfig,
  type PopulateSpec,
} from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'
import { getAdminBylineClient } from '@/lib/byline-client'
import { serialise } from './utils'

// ---------------------------------------------------------------------------
// Get document (current version, with optional published-version metadata)
// ---------------------------------------------------------------------------

const getDocumentFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      collection: string
      id: string
      locale?: string
      depth?: number
      populateRelations?: boolean
    }) => input
  )
  .handler(async ({ data }) => {
    const { collection: path, id, locale, depth, populateRelations } = data
    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const client = getAdminBylineClient()
    const handle = client.collection(path)

    // Determine populate strategy. The admin API-preview path passes an
    // explicit `depth > 0` and uses `'*'` to walk every relation with the
    // full document projection — useful for the debug/preview UI but
    // wasteful elsewhere. The admin edit loader sets `populateRelations`
    // to auto-build a depth-1 projection from the schema's relation
    // fields, so each target gets just its picker columns + useAsTitle
    // and relation-summary tiles render on first paint without per-tile
    // fetches.
    const populateRequested = typeof depth === 'number' && depth > 0
    const autoRelationsActive = !populateRequested && populateRelations === true

    let populate: PopulateSpec | undefined
    let resolvedDepth: number | undefined
    if (populateRequested) {
      populate = '*'
      resolvedDepth = depth
    } else if (autoRelationsActive) {
      const populateMap = buildRelationSummaryPopulateMap(
        config.definition.fields,
        (targetPath) => ({
          def: getCollectionDefinition(targetPath),
          admin: getCollectionAdminConfig(targetPath),
        })
      )
      if (Object.keys(populateMap).length > 0) {
        populate = populateMap
        resolvedDepth = 1
      }
    }

    const document = await handle.findById(id, {
      locale: locale ?? 'en',
      populate,
      depth: resolvedDepth,
      status: 'any',
    })

    if (!document) {
      throw ERR_NOT_FOUND({
        message: 'Document not found',
        details: { documentId: id, collectionPath: path },
      }).log(logger)
    }

    const serialised = serialise(document)

    // Skip the strict per-locale Zod parse when:
    //   - locale === 'all' (fields are locale-keyed objects, not per-locale values)
    //   - populated (the tree now contains nested populated documents that
    //     don't match the raw relation-ref shape the schema expects —
    //     applies equally to the depth-based preview path and the
    //     admin-edit relation-summary path)
    const populatedTree = populateRequested || autoRelationsActive
    const parsed =
      locale === 'all' || populatedTree
        ? (serialised as Record<string, any>)
        : (() => {
            const { get } = getCollectionSchemasForPath(path)
            return get.parse(serialised)
          })()

    // If the current version is not published, check whether a separate
    // published version exists so the UI can show a "published is live"
    // badge. This is admin-bespoke metadata — `db.queries.documents.*` is
    // the documented escape hatch for it. Reshaped to camelCase to match
    // the surrounding ClientDocument shape.
    let publishedVersion: Record<string, any> | null = null
    if ((parsed as any).status !== 'published') {
      const pv = await getServerConfig().db.queries.documents.getPublishedVersion({
        collection_id: config.collection.id,
        document_id: id,
      })
      publishedVersion = pv
        ? serialise({
            id: pv.document_id,
            versionId: pv.document_version_id,
            status: pv.status,
            createdAt: pv.created_at,
            updatedAt: pv.updated_at,
          })
        : null
    }

    return { ...(parsed as Record<string, any>), _publishedVersion: publishedVersion }
  })

// ---------------------------------------------------------------------------
// Get document by specific version ID (for history / diff views)
// ---------------------------------------------------------------------------

const getDocumentByVersionFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; versionId: string; locale?: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, versionId, locale } = data
    const resolvedLocale = locale ?? 'all'

    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const document = await getAdminBylineClient()
      .collection(path)
      .findByVersion(versionId, { locale: resolvedLocale })

    if (!document) {
      throw ERR_NOT_FOUND({
        message: 'Document version not found',
        details: { documentVersionId: versionId, collectionPath: path },
      }).log(logger)
    }

    const serialised = serialise(document)

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
 * When `depth > 0` is supplied, relation leaves are populated before the
 * response is returned — this is the hook that powers the admin
 * API-preview Depth selector. The returned tree then contains nested
 * shaped `ClientDocument`s at relation sites instead of bare
 * `{target_document_id, target_collection_id}` refs.
 */
export async function getCollectionDocument(
  collection: string,
  id: string,
  locale?: string,
  depth?: number,
  populateRelations?: boolean
) {
  try {
    return await getDocumentFn({
      data: { collection, id, locale, depth, populateRelations },
    })
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
