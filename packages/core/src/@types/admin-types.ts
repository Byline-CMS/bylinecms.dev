/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from './collection-types.js'

/**
 * Column definition for collection list views.
 * This is purely an admin/UI concern — it controls how documents
 * are displayed in the dashboard list table.
 */
export interface ColumnDefinition<T = any> {
  fieldName: keyof T
  label: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  className?: string
  formatter?: (value: any, record: T) => any
}

/**
 * Per-field admin UI configuration.
 * Controls how individual fields are rendered in the admin dashboard.
 */
export interface FieldAdminConfig {
  /** Where to place the field in the edit form layout. */
  position?: 'default' | 'sidebar'
  // Future: custom component overrides, editor config, etc.
}

/**
 * Admin UI configuration for a collection.
 * This is the presentation/UI layer — separate from the data schema.
 *
 * Linked to a CollectionDefinition by the `slug` field matching
 * the collection's `path`.
 */
export interface CollectionAdminConfig<T = any> {
  /** Must match the `path` of the corresponding CollectionDefinition. */
  slug: string

  /** Which field to use as the document title in list views. */
  useAsTitle?: string

  /** Group name for organizing collections in the admin sidebar. */
  group?: string

  /** Column definitions for the collection list view. */
  columns?: ColumnDefinition<T>[]

  /** Default columns to show when no explicit column config is provided. */
  defaultColumns?: string[]

  /** Per-field admin UI overrides, keyed by field name. */
  fields?: Record<string, FieldAdminConfig>

  /** Preview URL builder for live preview links. */
  preview?: (doc: T, ctx: { locale?: string }) => string
}

/**
 * Type-safe factory for creating a CollectionAdminConfig linked to a schema.
 * Infers field names from the collection definition for autocomplete.
 */
export function defineAdmin<T = any>(
  schema: CollectionDefinition,
  config: Omit<CollectionAdminConfig<T>, 'slug'>
): CollectionAdminConfig<T> {
  return {
    slug: schema.path,
    ...config,
  }
}
