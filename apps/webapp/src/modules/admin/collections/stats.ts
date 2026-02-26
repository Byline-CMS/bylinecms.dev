import { getCollectionStatsFn } from './server-fns'
import type { CollectionStatusCount } from './server-fns'

export type { CollectionStatusCount }

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
