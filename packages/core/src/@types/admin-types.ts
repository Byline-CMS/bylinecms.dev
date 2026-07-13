/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, WorkflowStatus } from './collection-types.js'
import type { FieldComponentSlots, RichTextEditorComponent } from './field-types.js'

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

/**
 * Default sort for a collection's list view, applied when the URL carries
 * no explicit `order`/`desc` search params. An explicit param always wins
 * (a shared link opens exactly as sent).
 *
 * `field` is a top-level schema field name (e.g. `'publicationDate'`) or a
 * document-level column (`'createdAt'`, `'updatedAt'`, `'path'`). Validated
 * at boot by `validateAdminConfigs`. Not allowed on `orderable: true`
 * collections — manual ordering already owns their default sort
 * (`order_key asc`).
 */
export interface ListDefaultSort<T = any> {
  field: keyof T | 'createdAt' | 'updatedAt' | 'path'
  /** Defaults to `'asc'`. */
  direction?: 'asc' | 'desc'
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
  /**
   * Per-field rich-text editor component override. When set on a
   * `type: 'richText'` field's admin entry, the framework renders this
   * component instead of the globally registered
   * `ClientConfig.fields.richText.editor`. Use to opt one specific field
   * into an alternate editor (e.g. an AI-enabled wrapper around the
   * default Lexical field) without changing the site-wide registration.
   *
   * Lives on the admin side rather than the schema side because it
   * carries a React component reference, and schemas must remain
   * tsx-loadable for seeds and the server bootstrap.
   *
   * Ignored for non-`richText` fields.
   */
  editor?: RichTextEditorComponent
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
   * Default sort for the list view when the URL carries no explicit
   * `order`/`desc` search params — e.g. a publications library that should
   * open newest-publication-first:
   *
   * ```ts
   * defaultSort: { field: 'publicationDate', direction: 'desc' },
   * ```
   *
   * Precedence: explicit URL params → this default → `created_at desc`.
   * Boot-validated: `field` must be a top-level schema field or a document
   * column (`createdAt` / `updatedAt` / `path`), and the option is rejected
   * on `orderable: true` collections (manual ordering owns their default).
   */
  defaultSort?: ListDefaultSort<T>

  /**
   * Column definitions for rendering this collection as a compact **item
   * row / tile** wherever a single document is shown outside its own list —
   * the relation picker modal, relation-summary tiles, `hasMany` relation
   * tiles, and (planned) cross-collection search-result rows.
   *
   * It is a per-collection *item contract*: it declares both **what to fetch**
   * (the projection — which fields hydrate the row, including relation
   * `displayField`s) and **how to render** (the columns + formatters, e.g. a
   * thumbnail cell or date formatter). Shape matches `ColumnDefinition` so
   * formatters are shared with the list view. Omit to fall back to a
   * single-line render of `useAsTitle` + `path`.
   *
   * Resolve it through `resolveItemViewColumns(config)` rather than reading
   * the field directly, so the deprecated `picker` alias keeps working.
   */
  itemView?: ColumnDefinition<T>[]

  /**
   * @deprecated Renamed to {@link itemView}. Kept as a backwards-compatible
   * alias — `itemView` wins when both are present. Read both via
   * `resolveItemViewColumns(config)`. Will be removed in a future major.
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
   * the preview link falls back through `CollectionDefinition.buildDocumentPath`
   * (the same schema-side hook the richtext embed walker reads, so the
   * public path and the Preview button agree by construction) and finally
   * to the conventional `/${collectionPath}/${doc.path}` — fine for
   * collections whose public URL mirrors the collection path.
   *
   * `url(doc, ctx)` — pure function returning the preview URL. Receives
   * the loaded document and a small request-scoped context object
   * carrying `locale`. Return `null` to indicate "no preview URL is
   * meaningful for this document yet" — `<PreviewLink>` hides itself
   * in that case (e.g. missing path, missing required relation, draft
   * awaiting first save).
   *
   * What's available on `doc`:
   *
   *   - **Top-level columns** — `id`, `path`, `status`. `path` is the
   *     slug derived server-side from the collection's `useAsPath`
   *     field; it is a reserved column on every document, not a
   *     user-defined field. Address as `doc.path`, not `doc.fields.path`.
   *
   *   - **Field values** under `doc.fields` — every scalar / array /
   *     block field of the source collection.
   *
   *   - **Direct relation targets** under `doc.fields.<name>?.document`
   *     — the edit-view loader applies a blanket depth-1 populate so
   *     relation tiles render with target data on first paint, and
   *     `url(...)` inherits the same populated tree. The projection
   *     follows the target's `picker` columns (plus top-level columns
   *     like `path`, which are always present). Deeper hops, or fields
   *     outside the target's picker projection, are NOT populated.
   *
   * Example for a `news` collection routed by its `category` relation:
   *
   * ```ts
   * preview: {
   *   url: (doc, { locale }) => {
   *     if (!doc.path) return null
   *     // `category` is a direct relation — auto-populated to depth 1.
   *     const category = doc.fields.category?.document?.path
   *     const prefix = locale && locale !== 'en' ? `/${locale}` : ''
   *     return category
   *       ? `${prefix}/news/${category}/${doc.path}`
   *       : `${prefix}/news/${doc.path}`
   *   },
   * }
   * ```
   *
   * Returned URLs may be relative (`/news/foo`) for same-origin hosts
   * or absolute (`https://example.com/news/foo`) for hosts deployed
   * separately from the admin.
   *
   * Future consideration — a per-collection `preview.populate` hint
   * (`PopulateSpec`) was prototyped and removed. The edit-view loader
   * already issues a depth-1 populate to render relation tiles, so any
   * selective override would have to coexist with the picker projection
   * (additive? overriding? both?) — extra surface area for a case no
   * current collection needs. Revisit if a real use case emerges
   * (deeper relation traversal, or a field outside the picker
   * projection that the URL builder needs).
   */
  preview?: {
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

  /**
   * Header action components for the **default** list view — rendered in the
   * list header alongside the Create button. Each receives a
   * {@link ListActionComponentProps} (`{ collectionPath }`). The reusable
   * injection point for collection-level admin actions (reindex search,
   * export, bulk operations, …) without replacing the whole `listView`.
   *
   * Ignored when a custom `listView` is provided (that component owns its own
   * chrome). Components are responsible for their own permission gating.
   *
   * @example
   * ```ts
   * import { ReindexButton } from '@byline/host-tanstack-start/admin-shell/collections/reindex-button'
   * // In your CollectionAdminConfig:
   * listActions: [ReindexButton],
   * ```
   */
  listActions?: Array<(props: ListActionComponentProps) => any>
}

/**
 * Props passed to each `CollectionAdminConfig.listActions` component. Kept
 * minimal and framework-agnostic (`@byline/core` is React-free); components
 * resolve everything else (server fns, abilities, toasts) from the host.
 */
export interface ListActionComponentProps {
  /** The collection path the list view is showing, e.g. `'docs'`. */
  collectionPath: string
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
