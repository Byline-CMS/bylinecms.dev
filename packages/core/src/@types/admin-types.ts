/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, WorkflowStatus } from './collection-types.js'
import type { FieldComponentSlots } from './field-types.js'
import type { PopulateSpec } from './populate-types.js'

/**
 * Props passed to a custom list-view component registered via
 * `CollectionAdminConfig.listView`.
 *
 * The `data` type mirrors the paginated API response shape
 * (`AnyCollectionSchemaTypes['ListType']` in the webapp). It is kept generic
 * here so that `@byline/core` remains React-free and framework-agnostic.
 */
export interface ListViewComponentProps<TData = any> {
  /** Paginated API response — includes `documents`, `meta`, and `included`. */
  data: TData
  /** Resolved workflow statuses for the collection, used to render labels. */
  workflowStatuses?: WorkflowStatus[]
}

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

// ---------------------------------------------------------------------------
// Layout primitives
//
// Each primitive is a flat top-level registry of named components. Membership
// is owned by the primitive itself — fields list themselves once, inside the
// primitive's `fields[]` array. Composition into the form's two render
// regions (`main` / `sidebar`) is handled by `LayoutDefinition` below.
//
// Nesting rules (enforced by the startup validator, not the type system):
//   - `tabSets` only appear in `layout.main`.
//   - Rows contain only schema field names (no nested rows/groups/tabs).
//   - Groups contain schema field names + row names (no tabs, no nested groups).
//   - Tab contents accept schema fields, row names, and group names.
//
// The path widget is form chrome — it is rendered structurally by the form
// renderer based on `CollectionDefinition.useAsPath` and is NOT addressable
// from `layout`. Admin configs cannot reference `'path'`.
// ---------------------------------------------------------------------------

/**
 * A single tab inside a tab set.
 */
export interface TabDefinition {
  /** Unique-within-its-set name used by the renderer to track active tab. */
  name: string
  /** Human-readable label rendered on the tab button. */
  label: string
  /** Schema field names, row names, or group names rendered inside this tab. */
  fields: string[]
  /**
   * Optional condition: when provided, the tab is only rendered when this
   * function returns true. Receives the current live form data, allowing
   * tabs to appear/disappear based on field values.
   *
   * Re-evaluated per keystroke via the form's meta-subscribe loop.
   * Client-only — must not be placed on `CollectionDefinition`.
   */
  condition?: (data: Record<string, any>) => boolean
}

/**
 * A named tab component — one tab bar containing one or more internal tabs.
 * Place by name in `layout.main`.
 */
export interface TabSetDefinition {
  /** Unique key used to reference this tab set in `layout.main`. */
  name: string
  /** Ordered tabs rendered by this tab bar. */
  tabs: TabDefinition[]
}

/**
 * A horizontal flex row of fields. Members are rendered side-by-side
 * (stacking below the `sm` breakpoint). Purely presentational; no storage
 * or schema impact. Rows are leaf containers — they accept only schema
 * field names.
 */
export interface RowDefinition {
  /** Unique key used to reference this row from `layout`, a tab, or a group. */
  name: string
  /** Ordered list of schema field names. */
  fields: string[]
}

/**
 * A labelled fieldset clustering related fields together. Purely presentational.
 * Groups accept schema field names and row names.
 */
export interface GroupDefinition {
  /** Unique key used to reference this group from `layout` or a tab. */
  name: string
  /** Optional heading rendered above the cluster (uses `<legend>`). */
  label?: string
  /** Ordered list of schema field names and row names. */
  fields: string[]
}

/**
 * Composition block — places primitives and raw schema field names into the
 * two render regions of the form.
 *
 * `main` accepts: tabSet | group | row | schema-field names.
 * `sidebar` accepts: group | row | schema-field names. (No tabSets.)
 *
 * When omitted entirely on `CollectionAdminConfig`, the renderer synthesises
 * `{ main: <all schema field names in order> }` so trivial collections
 * render with sensible defaults.
 */
export interface LayoutDefinition {
  main: string[]
  sidebar?: string[]
}

/**
 * Per-field admin UI configuration — purely rendering overrides.
 * Placement (tab/row/group/sidebar) is handled exclusively through the
 * layout primitives above.
 */
export interface FieldAdminConfig {
  /**
   * Optional UI component overrides for this field's rendering.
   * Only meaningful for value fields (not array, blocks, or group).
   * @see FieldComponentSlots
   */
  components?: FieldComponentSlots
}

/**
 * Minimal document shape passed to `CollectionAdminConfig.preview.url`.
 *
 * Inlined here (rather than importing `ClientDocument` from `@byline/client`)
 * so `@byline/core` stays a leaf package — admin config types must not pull
 * in the client. The shape mirrors the public `ClientDocument` envelope:
 * top-level columns (`path`, `status`, etc.) are addressable directly, and
 * the field shape is generic so callers narrowing `CollectionAdminConfig<T>`
 * get autocomplete inside `doc.fields`.
 */
export interface PreviewDocument<F = any> {
  id: string
  path: string
  status: string
  fields: F
}

/**
 * Admin UI configuration for a collection.
 * This is the presentation/UI layer — separate from the data schema.
 *
 * Linked to a `CollectionDefinition` by `slug` matching the collection's
 * `path`.
 */
export interface CollectionAdminConfig<T = any> {
  /** Must match the `path` of the corresponding `CollectionDefinition`. */
  slug: string

  /** Group name for organising collections in the admin sidebar. */
  group?: string

  /** Column definitions for the collection list view. */
  columns?: ColumnDefinition<T>[]

  /**
   * Column definitions for this collection when it appears as the target
   * of a relation picker (the modal opened from a `relation` field widget).
   *
   * Shape matches `ColumnDefinition` so formatters like a thumbnail cell or
   * date formatter can be reused across list and picker. Omit to fall back
   * to a single-line render of `useAsTitle` + `path`.
   *
   * Purely a UI concern — does not affect populate's default projection,
   * which uses `CollectionDefinition.useAsTitle` server-side.
   */
  picker?: ColumnDefinition<T>[]

  /** Default columns to show when no explicit column config is provided. */
  defaultColumns?: string[]

  /** Named tab components. Each set is one tab bar. */
  tabSets?: TabSetDefinition[]

  /** Named horizontal-row layouts. */
  rows?: RowDefinition[]

  /** Named labelled-fieldset clusters. */
  groups?: GroupDefinition[]

  /**
   * Composition: how the primitives above (and any raw schema fields) flow
   * into the form's `main` and `sidebar` regions. When omitted, the
   * renderer synthesises a default that places every schema field in
   * `main` in declaration order.
   */
  layout?: LayoutDefinition

  /**
   * Per-field rendering overrides, keyed by field name.
   * Placement is no longer expressed here — see the layout primitives above.
   */
  fields?: Record<string, FieldAdminConfig>

  /**
   * Preview URL configuration for the admin's live-preview affordance
   * (`<PreviewLink>` icon on the document edit page header). When omitted,
   * the preview link defaults to `/${collectionPath}/${doc.path}` — fine
   * for collections whose public URL mirrors the collection path.
   *
   * Two parts:
   *
   *   - `populate` (optional) — populate hint applied when the admin loads
   *     the document for the preview link. Lets `url(doc, ctx)` see resolved
   *     relation values (e.g. `doc.fields.area?.document?.path`) instead
   *     of the bare `RelatedDocumentValue` envelope. Selective by design —
   *     full populate per-row would be expensive for list views if/when
   *     preview links land there too.
   *
   *   - `url(doc, ctx)` — pure function returning the preview URL. Receives
   *     the (optionally populated) document and a small request-scoped
   *     context object carrying `locale`. Return `null` to indicate "no
   *     preview URL is meaningful for this document yet" — `<PreviewLink>`
   *     hides itself in that case (e.g. missing slug, missing required
   *     relation, draft awaiting first save).
   *
   * Example for a `pages` collection routed by `area` relation:
   *
   * ```ts
   * preview: {
   *   populate: { area: '*' },
   *   url: (doc, { locale }) => {
   *     const area = doc.fields.area?.document?.path
   *     const slug = doc.fields.slug
   *     if (!slug) return null
   *     const prefix = locale && locale !== 'en' ? `/${locale}` : ''
   *     return area && area !== 'root'
   *       ? `${prefix}/${area}/${slug}`
   *       : `${prefix}/${slug}`
   *   },
   * }
   * ```
   *
   * Returned URLs may be relative (`/news/foo`) for same-origin hosts
   * or absolute (`https://example.com/news/foo`) for hosts deployed
   * separately from the admin.
   */
  preview?: {
    populate?: PopulateSpec
    url: (doc: PreviewDocument<T>, ctx: { locale?: string }) => string | null
  }

  /**
   * Custom list-view component for this collection.
   *
   * When provided, this component completely replaces the default table-based
   * `ListView` on the collection index route. It receives a `ListViewComponentProps`
   * object and is responsible for rendering search, ordering, results, and
   * pagination itself.
   *
   * This is the primary extensibility point for non-tabular layouts such as
   * card grids, kanban boards, or calendar views.
   *
   * @example
   * ```ts
   * // In your CollectionAdminConfig:
   * listView: MediaListView,
   * ```
   */
  listView?: (props: ListViewComponentProps) => any
}

/**
 * Type-safe factory for creating a `CollectionAdminConfig` linked to a schema.
 * Sets `slug` from the schema's `path`.
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
