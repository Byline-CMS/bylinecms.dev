/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-side search finishing pipeline + the cross-collection (zone)
 * entry point.
 *
 * The provider ranks; core authorises and hydrates. Both `client.search({
 * zone })` and `CollectionHandle.search()` hand their provider hits to
 * `finalizeSearchHits`, which — per collection represented in the hits —
 * applies `beforeRead` row scoping (re-resolving candidate ids through the
 * normal read path) and, when `hydrate` is requested, batch-reads the hits
 * into shaped `ClientDocument`s in the same query.
 */

import type { RequestContext } from '@byline/auth'
import type { ReadContext, ReadMode, SearchHit } from '@byline/core'
import {
  applyBeforeRead,
  assertActorCanPerform,
  createReadContext,
  ERR_VALIDATION,
  getCollectionAdminConfig,
  resolveItemViewColumns,
  resolveSearchZones,
} from '@byline/core'

import type { BylineClient } from './client.js'
import type {
  ClientDocument,
  ClientSearchResults,
  HydratedSearchHit,
  ZoneSearchOptions,
} from './types.js'

// ---------------------------------------------------------------------------
// Shared finishing pipeline
// ---------------------------------------------------------------------------

export interface FinalizeSearchHitsParams {
  client: BylineClient<any>
  requestContext: RequestContext
  hits: SearchHit[]
  locale?: string
  status?: ReadMode
  hydrate?: boolean
  bypassBeforeRead?: true
  /** Shared per-request read context (beforeRead cache). Created when omitted. */
  readContext?: ReadContext
}

/**
 * Authorise (and optionally hydrate) provider hits, per collection:
 *
 *   - `hydrate: true` — batch-read each collection's hit ids through the
 *     normal read path (`find` with `id: { $in }`). The read applies
 *     `beforeRead` row scoping as a side effect, so authorisation and
 *     hydration cost one query per collection. Hits whose document doesn't
 *     come back — dropped by scoping, or a stale index entry whose document
 *     no longer resolves — are removed; the rest carry `hit.document`.
 *   - `hydrate` off — collections with a `beforeRead` predicate get the
 *     trimmed id re-resolution (identity-field projection); collections
 *     without one pass through untouched (no second query).
 *
 * Hits whose `collectionPath` isn't registered in the runtime config are
 * dropped with a debug log (an index can outlive a collection). Original
 * ranking order is preserved.
 */
export async function finalizeSearchHits(
  params: FinalizeSearchHitsParams
): Promise<HydratedSearchHit[]> {
  const { client, requestContext, hits, locale, status, hydrate, bypassBeforeRead } = params
  if (hits.length === 0) return hits
  const readCtx = params.readContext ?? createReadContext()

  // Group hit ids by collection, preserving overall ranking order for the
  // final reassembly.
  const byCollection = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const group = byCollection.get(hit.collectionPath)
    if (group) group.push(hit)
    else byCollection.set(hit.collectionPath, [hit])
  }

  // Per collection: resolve either a hydrated document map or an allowed-id
  // set. `null` means "no filtering — pass the group through".
  const documentsByCollection = new Map<string, Map<string, ClientDocument>>()
  const allowedByCollection = new Map<string, Set<string> | null>()

  for (const [collectionPath, group] of byCollection) {
    const definition = client.collections.find((c) => c.path === collectionPath)
    if (definition == null) {
      client.logger.debug(
        { collectionPath },
        'search: dropping hits for a collection not registered in the runtime config'
      )
      allowedByCollection.set(collectionPath, new Set())
      continue
    }

    const ids = group.map((h) => h.documentId)
    const handle = client.collection(collectionPath)

    if (hydrate) {
      // itemView columns are the projection when the admin config is
      // registered in this runtime; otherwise read the full field set.
      const itemView = resolveItemViewColumns(getCollectionAdminConfig(collectionPath))
      const select =
        itemView != null && itemView.length > 0
          ? Array.from(
              new Set(
                [...itemView.map((c) => String(c.fieldName)), definition.useAsTitle].filter(
                  (f): f is string => typeof f === 'string' && f.length > 0
                )
              )
            )
          : undefined
      const result = await handle.find({
        where: { id: { $in: ids } },
        select,
        locale,
        status,
        page: 1,
        pageSize: ids.length,
        _readContext: readCtx,
        ...(bypassBeforeRead ? { _bypassBeforeRead: true as const } : {}),
      })
      documentsByCollection.set(
        collectionPath,
        new Map(result.docs.map((d) => [d.id, d as ClientDocument]))
      )
      continue
    }

    if (bypassBeforeRead) {
      allowedByCollection.set(collectionPath, null)
      continue
    }

    const predicate = await applyBeforeRead({ definition, requestContext, readContext: readCtx })
    if (predicate == null) {
      allowedByCollection.set(collectionPath, null)
      continue
    }

    // Row scoping applies — re-resolve the candidate ids through the normal
    // read path (find re-applies the cached predicate AND-merged with the id
    // set), projected to the identity field.
    const result = await handle.find({
      where: { id: { $in: ids } },
      select: definition.useAsTitle != null ? [definition.useAsTitle] : undefined,
      locale,
      status,
      page: 1,
      pageSize: ids.length,
      _readContext: readCtx,
    })
    allowedByCollection.set(collectionPath, new Set(result.docs.map((d) => d.id)))
  }

  // Reassemble in the provider's ranking order.
  const finished: HydratedSearchHit[] = []
  for (const hit of hits) {
    if (hydrate) {
      const doc = documentsByCollection.get(hit.collectionPath)?.get(hit.documentId)
      if (doc == null) continue
      finished.push({ ...hit, document: doc })
      continue
    }
    const allowed = allowedByCollection.get(hit.collectionPath)
    if (allowed === null) {
      finished.push(hit)
    } else if (allowed?.has(hit.documentId)) {
      finished.push(hit)
    }
  }
  return finished
}

// ---------------------------------------------------------------------------
// Zone (cross-collection) entry point
// ---------------------------------------------------------------------------

/**
 * Cross-collection search over a named zone. Membership is resolved from
 * the runtime collection definitions (`search.zones`, defaulting to the
 * collection's own path — the same rule the indexing assembler applies);
 * collections the actor cannot `read` are excluded from the scope. Throws
 * `ERR_VALIDATION` for a zone no collection indexes into; rethrows the
 * ability error only when the actor can read none of the members.
 */
export async function zoneSearch(
  client: BylineClient<any>,
  options: ZoneSearchOptions
): Promise<ClientSearchResults> {
  const provider = client.searchProvider
  if (provider == null) {
    throw ERR_VALIDATION({
      message:
        'No search provider is registered. Register one on ServerConfig.search — ' +
        'see `@byline/search-postgres` → `postgresSearch()` for the built-in driver.',
    })
  }

  const members = client.collections.filter((c) =>
    (resolveSearchZones(c) ?? []).includes(options.zone)
  )
  if (members.length === 0) {
    throw ERR_VALIDATION({
      message:
        `No collection indexes into search zone '${options.zone}'. Declare zone ` +
        'membership via the collection `search.zones` config (a collection without ' +
        'explicit zones belongs to the implicit zone named after its own path).',
    })
  }

  // Per-member read gate: exclude collections the actor can't read; only
  // when *none* are readable does the ability error surface.
  const requestContext = await client.resolveRequestContext()
  const readable = new Set<string>()
  let firstAbilityError: unknown
  for (const member of members) {
    try {
      assertActorCanPerform(requestContext, member.path, 'read')
      readable.add(member.path)
    } catch (err) {
      firstAbilityError ??= err
      client.logger.debug(
        { collectionPath: member.path, zone: options.zone },
        'zone search: excluding collection the actor cannot read'
      )
    }
  }
  if (readable.size === 0) {
    throw firstAbilityError
  }

  const results = await provider.search({
    query: options.query,
    zone: options.zone,
    locale: options.locale ?? client.defaultLocale,
    status: options.status === 'any' ? 'any' : 'published',
    where: options.where,
    facets: options.facets,
    limit: options.limit,
    offset: options.offset,
  })

  // Constrain to readable member collections, then authorise / hydrate.
  const scoped = results.hits.filter((h) => readable.has(h.collectionPath))
  const hits = await finalizeSearchHits({
    client,
    requestContext,
    hits: scoped,
    locale: options.locale,
    status: options.status,
    hydrate: options.hydrate,
    bypassBeforeRead: options._bypassBeforeRead,
  })

  return { hits, total: results.total, facets: results.facets }
}
