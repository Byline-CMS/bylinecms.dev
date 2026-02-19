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
