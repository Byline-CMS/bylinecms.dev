/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ensureCollection } from '@/integrations/byline/api-utils'
import { getAdminBylineClient } from '@/integrations/byline/byline-client'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface CollectionStatusCount {
  status: string
  count: number
}

// ---------------------------------------------------------------------------
// Collection stats (per-status document counts)
// ---------------------------------------------------------------------------

const getCollectionStatsFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string }) => input)
  .handler(async ({ data }) => {
    const config = await ensureCollection(data.collection)
    if (!config) return { stats: [] as CollectionStatusCount[] }

    // Routes through CollectionHandle.countByStatus so per-status counts
    // reflect the actor's beforeRead predicate (multi-tenant scoping,
    // owner-only drafts, etc).
    const counts = await getAdminBylineClient().collection(data.collection).countByStatus()

    return { stats: counts as CollectionStatusCount[] }
  })

/**
 * Fetch per-status document counts for a collection.
 * Returns an empty array on any error so the caller can degrade gracefully.
 */
export async function getCollectionStats(collection: string): Promise<CollectionStatusCount[]> {
  try {
    const result = await getCollectionStatsFn({ data: { collection } })
    return result.stats
  } catch {
    return []
  }
}
