/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
