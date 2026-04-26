/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import type {
  BeforeReadHookFn,
  BeforeReadHookSlot,
  CollectionDefinition,
} from '../@types/collection-types.js'
import type { ReadContext } from '../@types/db-types.js'
import type { QueryPredicate } from '../@types/query-predicate.js'

/**
 * Resolve the per-collection `beforeRead` hook predicate for the current
 * request, with caching across populate fanout.
 *
 * Behaviour:
 *   - Cache hit on `readContext.beforeReadCache` (keyed by collection
 *     path) returns the cached value immediately. The actor is invariant
 *     for the lifetime of one `ReadContext`, so a single key per
 *     collection is sufficient.
 *   - Each configured hook function runs in declaration order. Predicates
 *     returned by multiple hooks are combined with implicit AND. Hooks
 *     that return `void` / `undefined` are skipped.
 *   - The result is stored in the cache (including `null` for "ran with
 *     no scoping") so subsequent batches in the same request reuse it.
 *
 * Returns `null` when no hook is configured, or every hook returned
 * void. Callers (`CollectionHandle`, `populateDocuments`) treat `null`
 * the same as "no scoping" — they pass nothing extra to the adapter.
 */
export async function applyBeforeRead(params: {
  definition: CollectionDefinition
  requestContext: RequestContext
  readContext: ReadContext
}): Promise<QueryPredicate | null> {
  const { definition, requestContext, readContext } = params
  const collectionPath = definition.path

  if (readContext.beforeReadCache.has(collectionPath)) {
    return readContext.beforeReadCache.get(collectionPath) ?? null
  }

  const hooks = normalizeBeforeReadHook(definition.hooks?.beforeRead)
  if (hooks.length === 0) {
    readContext.beforeReadCache.set(collectionPath, null)
    return null
  }

  const predicates: QueryPredicate[] = []
  for (const hook of hooks) {
    const result = await hook({
      collectionPath,
      requestContext,
      readContext,
    })
    if (result != null) {
      predicates.push(result)
    }
  }

  let combined: QueryPredicate | null
  if (predicates.length === 0) {
    combined = null
  } else if (predicates.length === 1) {
    combined = predicates[0]!
  } else {
    combined = { $and: predicates }
  }

  readContext.beforeReadCache.set(collectionPath, combined)
  return combined
}

/** Normalise a `beforeRead` slot (single function or array) into a flat array. */
function normalizeBeforeReadHook(slot: BeforeReadHookSlot | undefined): BeforeReadHookFn[] {
  if (!slot) return []
  return Array.isArray(slot) ? slot : [slot]
}
