/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminBylineClient } from '@byline/client/server'
import {
  buildRelationSummaryPopulateMap,
  ERR_NOT_FOUND,
  getCollectionAdminConfig,
  getCollectionDefinition,
  getCollectionSchemasForPath,
  getLogger,
  getServerConfig,
  type PopulateSpec,
  type QueryPredicate,
} from '@byline/core'

import { ensureCollection } from '../../integrations/api-utils.js'
import { serialise } from './utils'

// ---------------------------------------------------------------------------
// Shared param types
// ---------------------------------------------------------------------------

export interface CollectionSearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  query?: string
  locale?: string
  status?: string
  fields?: string[]
}

// ---------------------------------------------------------------------------
// List documents
// ---------------------------------------------------------------------------

export const getCollectionDocuments = createServerFn({ method: 'GET' })
  .validator((input: { collection: string; params: CollectionSearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, params } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }

    const client = getAdminBylineClient()
    const handle = client.collection(path)
    const pageSize = params.page_size ?? 20

    // Routes through CollectionHandle.find so the read pipeline (beforeRead
    // → findDocuments → afterRead) is identical to any non-admin client.
    // `status: 'any'` keeps admin behaviour: in-progress drafts are visible
    // even when no published version exists. The `where.status` filter
    // (when supplied) further narrows to a specific exact status, and
    // `where.query` triggers the configured search-fields text search.
    const where: QueryPredicate = {}
    if (params.status) where.status = params.status
    if (params.query) where.query = params.query

    // Sort precedence: the caller's explicit `params.order` always wins (a
    // shared link opens exactly as sent) → `orderable: true` collections
    // default to the fractional `order_key` ascending → the admin config's
    // `defaultSort` (boot-validated; mutually exclusive with `orderable`) →
    // the storage fallback (`created_at desc`). `configuredSort` is also
    // echoed through `meta.order`/`meta.desc` below so the list header can
    // render the effective sort indicator on a params-less landing.
    const adminConfig = getCollectionAdminConfig(path)
    const configuredSort =
      !params.order && config.definition.orderable !== true && adminConfig?.defaultSort != null
        ? {
            order: String(adminConfig.defaultSort.field),
            desc: adminConfig.defaultSort.direction === 'desc',
          }
        : undefined
    const defaultSort: Record<string, 'asc' | 'desc'> | undefined =
      config.definition.orderable === true
        ? { order_key: 'asc' }
        : configuredSort != null
          ? { [configuredSort.order]: configuredSort.desc ? 'desc' : 'asc' }
          : undefined
    const sortSpec: Record<string, 'asc' | 'desc'> | undefined = params.order
      ? { [params.order]: params.desc === false ? 'asc' : 'desc' }
      : defaultSort

    // Auto-populate relation columns (depth 1) so the list renders each
    // target's title (via `relationColumnFormatter`) rather than a raw
    // document id. Projection follows each target's `itemView` columns +
    // `useAsTitle` — the same map the edit view uses. Populate only fires for
    // relation fields actually loaded (i.e. selected as columns), so building
    // the full map is harmless for collections whose relations aren't shown.
    const populateMap = buildRelationSummaryPopulateMap(config.definition.fields, (targetPath) => ({
      def: getCollectionDefinition(targetPath),
      admin: getCollectionAdminConfig(targetPath),
    }))
    const hasRelations = Object.keys(populateMap).length > 0
    const populate: PopulateSpec | undefined = hasRelations ? populateMap : undefined

    const result = await handle.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      sort: sortSpec,
      locale: params.locale ?? 'en',
      page: params.page,
      pageSize,
      select: params.fields,
      populate,
      depth: hasRelations ? 1 : undefined,
      status: 'any',
      // Admin list: show the raw per-locale state (untranslated docs render
      // empty in the active locale's columns) rather than falling back to the
      // default locale. Consistent with the edit view; overrides the client's
      // `'fallback'` default.
      onMissingLocale: 'empty',
    })

    // Decorate each doc with `hasPublishedVersion` so the list UI can show a
    // "live" indicator on documents that still have a published version
    // even when the current row is a newer draft. This is admin-bespoke
    // metadata, so it sits alongside the public ClientDocument shape rather
    // than inside it.
    const documentIds = result.docs.map((d) => d.id)
    const publishedSet =
      documentIds.length > 0
        ? await getServerConfig().db.queries.documents.getPublishedDocumentIds({
            collection_id: config.collection.id,
            document_ids: documentIds,
          })
        : new Set<string>()

    const docs = result.docs.map((d) => ({
      ...d,
      hasPublishedVersion: publishedSet.has(d.id),
    }))

    const response = {
      docs,
      meta: {
        ...result.meta,
        // The *effective* sort: explicit params, or the configured
        // `defaultSort` when it filled in. The list header renders its
        // sort indicator from this, so a params-less landing still shows
        // which column ordered the rows.
        order: params.order ?? configuredSort?.order,
        desc: params.desc ?? configuredSort?.desc,
      },
      included: {
        collection: {
          id: config.collection.id,
          path: config.collection.path,
          labels: {
            singular: config.definition.labels.singular || config.collection.path,
            plural: config.definition.labels.plural || config.collection.path,
          },
        },
      },
    }

    const serialised = serialise(response)

    // Validate with schema for runtime type safety and field normalisation.
    const { list } = getCollectionSchemasForPath(path)

    // Skip the per-locale Zod parse when relations were populated — the tree
    // then carries nested populated documents that don't match the raw
    // relation-ref shape the list schema expects, and a strict parse would
    // strip the `_resolved` / `document` envelope keys the relation formatter
    // reads. Mirrors the edit-route (`get.ts`) populated-tree handling.
    if (hasRelations) {
      return serialised as unknown as ReturnType<typeof list.parse>
    }

    return list.parse(serialised)
  })
