/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

import {
  type CollectionDefinition,
  isSingleton,
  type MultiCollectionDefinition,
  type SingletonDefinition,
} from '../@types/index.js'

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

/** The smaller ability family contributed by every singleton. */
export const SINGLETON_ABILITY_VERBS = ['read', 'update', 'publish', 'changeStatus'] as const

export type CollectionAbilityVerb = (typeof COLLECTION_ABILITY_VERBS)[number]
export type SingletonAbilityVerb = (typeof SINGLETON_ABILITY_VERBS)[number]

/** Minimal explicit descriptor for collection ability checks. */
export interface CollectionAbilityResourceDescriptor {
  kind: 'collection'
  path: string
}

/** Minimal explicit descriptor for singleton ability checks. */
export interface SingletonAbilityResourceDescriptor {
  kind: 'singleton'
  path: string
}

export type CollectionAbilityResource =
  | MultiCollectionDefinition
  | CollectionAbilityResourceDescriptor
export type SingletonAbilityResource = SingletonDefinition | SingletonAbilityResourceDescriptor
export type DocumentAbilityResource = CollectionAbilityResource | SingletonAbilityResource

/** Correlate the permitted verb family with the resource kind. */
export type DocumentAbilityVerbFor<Resource extends DocumentAbilityResource> =
  Resource extends SingletonAbilityResource ? SingletonAbilityVerb : CollectionAbilityVerb

/**
 * Compute a document-resource ability key from a kind-bearing descriptor.
 *
 * TypeScript callers cannot pair a known singleton with collection-only verbs.
 * Runtime validation preserves the same boundary for untyped JavaScript callers
 * and for union-typed definitions whose concrete kind is known only at runtime.
 */
export function documentAbilityKey<Resource extends DocumentAbilityResource>(
  resource: Resource,
  verb: DocumentAbilityVerbFor<Resource>
): string {
  const kind = resourceKind(resource)
  const candidate = verb as string
  const allowed: readonly string[] =
    kind === 'singleton' ? SINGLETON_ABILITY_VERBS : COLLECTION_ABILITY_VERBS

  if (!allowed.includes(candidate)) {
    throw new TypeError(`ability verb '${candidate}' is not valid for resource kind '${kind}'`)
  }

  return `${resourceNamespace(kind)}.${resource.path}.${candidate}`
}

/** @deprecated Use {@link documentAbilityKey} with a kind-bearing resource descriptor. */
export function collectionAbilityKey(path: string, verb: CollectionAbilityVerb): string {
  return documentAbilityKey({ kind: 'collection', path }, verb)
}

/** Auto-register the seven abilities contributed by a multi-document collection. */
export function registerCollectionAbilities(
  registry: AbilityRegistry,
  definition: MultiCollectionDefinition
): void {
  const group = documentAbilityGroup(definition)
  const { singular, plural } = definition.labels
  const labels: Record<CollectionAbilityVerb, string> = {
    read: `Read ${plural}`,
    create: `Create ${singular}`,
    update: `Update ${singular}`,
    delete: `Delete ${singular}`,
    publish: `Publish ${plural}`,
    changeStatus: `Change status of ${plural}`,
    reindex: `Reindex ${plural} search`,
  }

  for (const verb of COLLECTION_ABILITY_VERBS) {
    registry.register({
      key: documentAbilityKey(definition, verb),
      label: labels[verb],
      group,
      source: 'collection',
    })
  }
}

/** Auto-register the four read, update, and workflow abilities for a singleton. */
export function registerSingletonAbilities(
  registry: AbilityRegistry,
  definition: SingletonDefinition
): void {
  const group = documentAbilityGroup(definition)
  const label = definition.label
  const labels: Record<SingletonAbilityVerb, string> = {
    read: `Read ${label}`,
    update: `Update ${label}`,
    publish: `Publish ${label}`,
    changeStatus: `Change status of ${label}`,
  }

  for (const verb of SINGLETON_ABILITY_VERBS) {
    registry.register({
      key: documentAbilityKey(definition, verb),
      label: labels[verb],
      group,
      source: 'collection',
    })
  }
}

/** Register the correct ability family for either document-resource kind. */
export function registerDocumentAbilities(
  registry: AbilityRegistry,
  definition: CollectionDefinition
): void {
  if (isSingleton(definition)) {
    registerSingletonAbilities(registry, definition)
    return
  }
  registerCollectionAbilities(registry, definition)
}

function documentAbilityGroup(resource: DocumentAbilityResource): string {
  return `${resourceNamespace(resourceKind(resource))}.${resource.path}`
}

function resourceKind(resource: DocumentAbilityResource): 'collection' | 'singleton' {
  if ('kind' in resource) return resource.kind
  return resource.singleton === true ? 'singleton' : 'collection'
}

function resourceNamespace(kind: 'collection' | 'singleton'): 'collections' | 'singletons' {
  return kind === 'singleton' ? 'singletons' : 'collections'
}
