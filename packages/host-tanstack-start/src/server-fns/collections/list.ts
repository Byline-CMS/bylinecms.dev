/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getPreferenceCommand } from '@byline/admin/admin-preferences'
import { getAdminBylineClient, getAdminRequestContext } from '@byline/client/server'
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
import { bylineCore } from '../../integrations/byline-core.js'
import { resolveListViewState, sortableFieldNames } from './list-view-state.js'
import { serialise } from './utils'
import type { ListViewPreferenceValue } from './list-view-state.js'

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

    // Routes through CollectionHandle.find so the read pipeline (beforeRead
    // → findDocuments → afterRead) is identical to any non-admin client.
    // `status: 'any'` keeps admin behaviour: in-progress drafts are visible
    // even when no published version exists. The `where.status` filter
    // (when supplied) further narrows to a specific exact status, and
    // `where.query` triggers the configured search-fields text search.
    const where: QueryPredicate = {}
    if (params.status) where.status = params.status
    if (params.query) where.query = params.query

    // Sort/page-size precedence (see list-view-state.ts): the caller's
    // explicit params always win (a shared link opens exactly as sent) →
    // the actor's stored per-collection preference → the admin config's
    // `defaultSort` → the storage fallback (`created_at desc`). The
    // effective sort is echoed through `meta.order`/`meta.desc` below so
    // the list header renders the right indicator on a params-less landing.
    const adminConfig = getCollectionAdminConfig(path)
    const configuredSort =
      config.definition.orderable !== true && adminConfig?.defaultSort != null
        ? {
            order: String(adminConfig.defaultSort.field),
            desc: adminConfig.defaultSort.direction === 'desc',
          }
        : undefined

    // Per-user preference — read only when it could matter (some param
    // absent). Failures (headless context, unauthenticated preview, DB
    // hiccup) log and fall through: preferences can never break the list.
    let preference: ListViewPreferenceValue | null = null
    const adminStore = bylineCore().adminStore
    if (adminStore != null && (params.page_size == null || params.order == null)) {
      try {
        const context = await getAdminRequestContext()
        const res = await getPreferenceCommand(
          context,
          { scope: `collections.${path}.list` },
          { store: adminStore }
        )
        preference = (res.value as ListViewPreferenceValue | null) ?? null
      } catch (err) {
        getLogger().warn(
          { err, collection: path },
          'list-view preference read failed — using defaults'
        )
      }
    }

    const viewState = resolveListViewState({
      params: { page_size: params.page_size, order: params.order, desc: params.desc },
      preference,
      orderable: config.definition.orderable === true,
      sortableFields: sortableFieldNames(config.definition.fields),
      configuredSort,
    })
    const pageSize = viewState.pageSize

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
      sort: viewState.sort,
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
        // The *effective* sort/page-size: explicit params, or the
        // resolved preference/configured `defaultSort` when they filled
        // in. The list header renders its sort indicator from this, so a
        // params-less landing still shows which column ordered the rows.
        order: viewState.metaOrder,
        desc: viewState.metaDesc,
        pageSize,
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
