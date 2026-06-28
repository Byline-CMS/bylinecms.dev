/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

import type { CollectionDefinition } from '../@types/index.js'

/**
 * Auto-register the CRUD + workflow abilities contributed by a collection.
 *
 * Every registered collection contributes exactly seven abilities, all in
 * the `collections.<path>` group:
 *
 *   - `collections.<path>.read`          — enumerate / fetch documents
 *   - `collections.<path>.create`        — create new documents
 *   - `collections.<path>.update`        — modify existing documents
 *   - `collections.<path>.delete`        — delete documents (soft or hard)
 *   - `collections.<path>.publish`       — transition a document into the
 *                                          `published` status
 *   - `collections.<path>.changeStatus`  — any other workflow transition
 *                                          (draft → custom state, etc.)
 *   - `collections.<path>.reindex`       — rebuild the collection's search
 *                                          index (admin maintenance task)
 *
 * Registration is unconditional: every collection in Byline has a workflow
 * (the default `draft → published → archived` one when not explicitly
 * configured), so `publish` and `changeStatus` always apply; `reindex` is
 * likewise uniform (a no-op for collections without a `search` config).
 * Keeping the seven-ability contract uniform makes the role editor UI
 * predictable and avoids hidden conditional logic downstream.
 *
 * Called from `initBylineCore()` for each declared collection. See
 * docs/AUTHN-AUTHZ.md.
 */
export function registerCollectionAbilities(
  registry: AbilityRegistry,
  definition: CollectionDefinition
): void {
  const path = definition.path
  const group = `collections.${path}`
  const base = `collections.${path}`
  const { singular, plural } = definition.labels

  registry.register({
    key: `${base}.read`,
    label: `Read ${plural}`,
    group,
    source: 'collection',
  })
  registry.register({
    key: `${base}.create`,
    label: `Create ${singular}`,
    group,
    source: 'collection',
  })
  registry.register({
    key: `${base}.update`,
    label: `Update ${singular}`,
    group,
    source: 'collection',
  })
  registry.register({
    key: `${base}.delete`,
    label: `Delete ${singular}`,
    group,
    source: 'collection',
  })
  registry.register({
    key: `${base}.publish`,
    label: `Publish ${plural}`,
    group,
    source: 'collection',
  })
  registry.register({
    key: `${base}.changeStatus`,
    label: `Change status of ${plural}`,
    group,
    source: 'collection',
  })
  registry.register({
    key: `${base}.reindex`,
    label: `Reindex ${plural} search`,
    group,
    source: 'collection',
  })
}

/** The ability suffixes that every collection contributes. Exposed for contract tests. */
export const COLLECTION_ABILITY_VERBS = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'changeStatus',
  'reindex',
] as const

export type CollectionAbilityVerb = (typeof COLLECTION_ABILITY_VERBS)[number]

/** Compute the full ability key for a collection path and verb. */
export function collectionAbilityKey(path: string, verb: CollectionAbilityVerb): string {
  return `collections.${path}.${verb}`
}
