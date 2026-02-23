/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from './collection-types.js'

/**
 * Props passed to a component-style column formatter.
 */
export interface FormatterProps<T = any> {
  /** The raw field value for this cell. */
  value: any
  /** The full document record for the current row. */
  record: T
}

/**
 * A column formatter is either:
 * - A plain function: `(value, record) => ReactNode | string`
 * - A component wrapper: `{ component: (props: FormatterProps) => ReactNode }`
 *
 * The `{ component }` form lets you use React hooks, context, or JSX
 * directly inside the cell renderer.
 */
export type ColumnFormatter<T = any> =
  | ((value: any, record: T) => any)
  | { component: (props: FormatterProps<T>) => any }

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
  formatter?: ColumnFormatter<T>
}

/**
 * A tab groups fields under a named tab in the edit form.
 * Tabs are a purely presentational concern — they do not affect field paths,
 * storage, patches, or validation.
 */
export interface TabDefinition {
  /** Unique key used to reference this tab in FieldAdminConfig. */
  name: string
  /** Human-readable label rendered on the tab button. */
  label: string
  /**
   * Optional condition: when provided, the tab is only rendered when this
   * function returns true. Receives the current live form data, allowing
   * tabs to appear/disappear based on field values.
   *
   * This is a client-only function and must not be placed on CollectionDefinition.
   */
  condition?: (data: Record<string, any>) => boolean
}

/**
 * A field group is a labelled visual section that clusters related fields
 * within a tab (or the default layout when no tabs are configured).
 * Purely presentational — no storage or schema impact.
 */
export interface GroupDefinition {
  /** Unique key used to reference this group in FieldAdminConfig. */
  name: string
  /** Optional heading rendered above the grouped fields. */
  label?: string
  /** When tabs are configured, restrict this group to a specific tab. */
  tab?: string
}

/**
 * A row lays out a set of named fields side-by-side horizontally.
 * Fields listed here are rendered in a flex row instead of the default
 * vertical stack. Purely presentational.
 */
export interface RowDefinition {
  /** Unique key used to reference this row in FieldAdminConfig. */
  name: string
  /** Ordered list of field names to render in a horizontal row. */
  fields: string[]
  /** When tabs are configured, restrict this row to a specific tab. */
  tab?: string
  /** When groups are configured, restrict this row to a specific group. */
  group?: string
}

/**
 * Per-field admin UI configuration.
 * Controls how individual fields are rendered in the admin dashboard.
 */
export interface FieldAdminConfig {
  /** Where to place the field in the edit form layout. */
  position?: 'default' | 'sidebar'
  /**
   * Which tab (by name) this field belongs to.
   * Requires `tabs` to be declared on the CollectionAdminConfig.
   */
  tab?: string
  /**
   * Which field group (by name) this field belongs to.
   * Requires `groups` to be declared on the CollectionAdminConfig.
   */
  group?: string
  /**
   * Which row (by name) this field belongs to.
   * Requires a matching entry in `rows` on the CollectionAdminConfig.
   */
  row?: string
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

  /**
   * Ordered tab declarations for tabbed form layouts.
   * Assign fields to tabs via `fields[fieldName].tab`.
   */
  tabs?: TabDefinition[]

  /**
   * Named visual grouping sections within the form (or within a tab).
   * Assign fields to groups via `fields[fieldName].group`.
   */
  groups?: GroupDefinition[]

  /**
   * Horizontal row layouts — fields listed in each row are rendered
   * side-by-side instead of stacked vertically.
   */
  rows?: RowDefinition[]

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
