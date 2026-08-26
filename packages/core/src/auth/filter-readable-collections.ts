/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { documentAbilityKey } from './register-collection-abilities.js'
import type { CollectionDefinition } from '../@types/collection-types.js'

/**
 * The ability facts a rendering surface needs about the current administrator.
 * Mirrors the snapshot the admin route places on router context in
 * `beforeLoad` — deliberately a plain data shape so this module stays
 * React-free and transport-agnostic.
 */
export interface ActorAbilitySnapshot {
  isSuperAdmin: boolean
  abilities: readonly string[]
}

/**
 * Narrow a document-resource list to those the administrator can read.
 *
 * `read` is the gate because everything a dashboard card offers — the link to
 * its editor/list view, and collection status counts — requires the resource's
 * kind-aware `collections.<path>.read` or `singletons.<path>.read` ability and
 * is rejected server-side without it. An administrator who cannot read a
 * collection would otherwise see a card whose status tiles all read zero,
 * which is indistinguishable from a collection that is genuinely empty.
 *
 * **Cosmetic only.** This is an affordance, never a security boundary.
 * `assertActorCanPerform` remains the enforcement point on every read and write
 * path; hiding a card only stops the interface advertising something the server
 * will refuse. Never rely on this function to keep data from anyone.
 *
 * Super-admin short-circuits, mirroring `AdminAuth.assertAbility` and the
 * client-side `useAbilities` hook.
 */
export function filterReadableCollections(
  collections: readonly CollectionDefinition[],
  snapshot: ActorAbilitySnapshot
): CollectionDefinition[] {
  if (snapshot.isSuperAdmin) return [...collections]

  const held = new Set(snapshot.abilities)
  return collections.filter((collection) => held.has(documentAbilityKey(collection, 'read')))
}
