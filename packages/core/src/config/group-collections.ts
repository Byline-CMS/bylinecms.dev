/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionAdminConfig, CollectionGroupDefinition } from '../@types/admin-types.js'
import type { CollectionDefinition } from '../@types/collection-types.js'

/**
 * One renderable section of the admin dashboard: a heading (or none) and the
 * collections beneath it.
 */
export interface CollectionGroupBucket<
  TDefinition extends CollectionDefinition = CollectionDefinition,
> {
  /** Registry key, or `null` for the leading ungrouped band. */
  name: string | null
  /** Heading text, or `null` when the band renders without a heading. */
  label: string | null
  collections: TDefinition[]
}

/**
 * Bucket collections into ordered dashboard sections.
 *
 * Rules:
 *  - The ungrouped band is emitted first, and omitted entirely when empty.
 *  - Declared groups follow in `collectionGroups` order.
 *  - A declared group with no members is skipped, so no heading ever appears
 *    above an empty section.
 *  - Collection declaration order is preserved within each bucket.
 *  - An absent or empty registry yields a single ungrouped bucket holding every
 *    collection — the flat grid Byline rendered before groups existed.
 *
 * This function is deliberately total: a `group` naming no declared entry is
 * treated as ungrouped rather than throwing. `validateCollectionGroups` rejects
 * that configuration at startup, so the fallback only ever covers a stale or
 * hand-built config object, where crashing the dashboard would be the worse
 * outcome.
 *
 * It takes no actor and knows nothing about abilities. Callers that need to
 * hide collections filter the `collections` argument first — see
 * `filterReadableCollections`. That ordering is what makes a group whose
 * members are all hidden disappear along with its heading: it arrives here with
 * no members and is skipped by the rule above.
 */
export function groupCollectionsForAdmin<TDefinition extends CollectionDefinition>(
  collections: readonly TDefinition[],
  admin: readonly CollectionAdminConfig[] | undefined,
  collectionGroups: readonly CollectionGroupDefinition[] | undefined
): CollectionGroupBucket<TDefinition>[] {
  const groupByCollectionPath = new Map<string, string>()
  for (const entry of admin ?? []) {
    if (entry.group != null) groupByCollectionPath.set(entry.slug, entry.group)
  }

  const membersByGroup = new Map<string, TDefinition[]>()
  for (const group of collectionGroups ?? []) {
    membersByGroup.set(group.name, [])
  }

  const ungrouped: TDefinition[] = []
  for (const collection of collections) {
    const groupName = groupByCollectionPath.get(collection.path)
    const members = groupName == null ? undefined : membersByGroup.get(groupName)
    if (members == null) {
      ungrouped.push(collection)
      continue
    }
    members.push(collection)
  }

  const buckets: CollectionGroupBucket<TDefinition>[] = []
  if (ungrouped.length > 0) {
    buckets.push({ name: null, label: null, collections: ungrouped })
  }
  for (const group of collectionGroups ?? []) {
    const members = membersByGroup.get(group.name) ?? []
    if (members.length === 0) continue
    buckets.push({ name: group.name, label: group.label, collections: members })
  }

  return buckets
}
