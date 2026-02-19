/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field } from './field-types.js'

/**
 * Lifecycle hooks for a collection.
 *
 * Each hook receives a context object. `beforeChange` hooks can mutate the
 * data before it is persisted; `afterChange` hooks receive the final data
 * after persistence.
 *
 * Hooks are optional — if omitted, the framework skips the step.
 */
export interface CollectionHooks {
  /** Runs before a new document is created. Can mutate `data`. */
  beforeCreate?: (ctx: {
    data: Record<string, any>
    collectionPath: string
  }) => void | Promise<void>
  /** Runs after a new document is created. */
  afterCreate?: (ctx: { data: Record<string, any>; collectionPath: string }) => void | Promise<void>
  /** Runs before an existing document is updated (PUT or patch). Can mutate `data`. */
  beforeUpdate?: (ctx: {
    data: Record<string, any>
    originalData: Record<string, any>
    collectionPath: string
  }) => void | Promise<void>
  /** Runs after an existing document is updated. */
  afterUpdate?: (ctx: {
    data: Record<string, any>
    originalData: Record<string, any>
    collectionPath: string
  }) => void | Promise<void>
  /** Runs before a document is deleted. */
  beforeDelete?: (ctx: { id: string; collectionPath: string }) => void | Promise<void>
  /** Runs after a document is deleted. */
  afterDelete?: (ctx: { id: string; collectionPath: string }) => void | Promise<void>
}

export interface CollectionDefinition {
  labels: {
    singular: string
    plural: string
  }
  path: string
  fields: Field[]
  /** Lifecycle hooks for server-side document operations. */
  hooks?: CollectionHooks
}

/**
 * Type-safe factory for creating a CollectionDefinition.
 * Returns the definition as-is but provides type checking.
 */
export function defineCollection(definition: CollectionDefinition): CollectionDefinition {
  return definition
}
