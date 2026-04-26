/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type CollectionAdminConfig, type ColumnDefinition, defineAdmin } from '@byline/core'

import { DateTimeFormatter } from '@/ui/fields/date-time-formatter.js'
import { SummaryLength } from '~/components/summary-length.js'
import { FeaturedFormatter } from './components/feature-formatter.js'
import { Docs } from './schema.js'

/**
 * Column definitions for the default table-based list view.
 *
 * These are passed to the built-in `ListView` component and control which
 * fields appear as columns, their labels, sort behaviour, and formatters.
 *
 * Note: when a custom `listView` component is registered on the
 * `CollectionAdminConfig`, it receives the raw paginated data directly and
 * is responsible for its own layout. These column definitions can still
 * be used in a custom list view, but they are not automatically applied
 * as they are with the default table-based `ListView`. You can import
 * them if needed - for example if you wanted to create a toggled grid/table
 * custom view.
 */
const listViewColumns: ColumnDefinition[] = [
  {
    fieldName: 'title',
    label: 'Title',
    sortable: true,
    align: 'left',
    className: 'w-[30%]',
  },
  {
    fieldName: 'featured',
    label: 'Featured',
    align: 'center',
    className: 'w-[10%]',
    formatter: { component: FeaturedFormatter },
  },
  {
    fieldName: 'status',
    label: 'Status',
    align: 'center',
    className: 'w-[15%]',
  },
  {
    fieldName: 'updated_at',
    label: 'Last Updated',
    sortable: true,
    align: 'right',
    className: 'w-[20%]',
    formatter: { component: DateTimeFormatter },
  },
]

/**
 * Columns rendered per row when a collection item appears as the 
 * target of a relation picker. Usually narrower than the list 
 * view — just enough to identify the right item at a glance.
 */
// const pickerViewColumns: ColumnDefinition[] = []


export const DocsAdmin: CollectionAdminConfig = defineAdmin(Docs, {
  /**
   * Column definitions for the default table-based list view.
   * Controls which fields appear as columns, their labels, sort behaviour, and formatters.
   */
  columns: listViewColumns,

  /**
   * Column definitions used when this collection appears as the target of a relation
   * picker modal (opened from a `relation` field widget). Omit to fall back to a
   * single-line render of `useAsTitle` + `path`.
   *
   * Shape matches `ColumnDefinition` so formatters can be reused across list and picker.
   *
   * @example
   * picker: [{ fieldName: 'title', label: 'Title' }] // or defined above as `pickerViewColumns`
   */
  // picker: [],

  /**
   * Custom list-view component that completely replaces the default table-based `ListView`
   * on the collection index route. Receives a `ListViewComponentProps` object and is
   * responsible for rendering search, ordering, results, and pagination itself.
   *
   * When omitted, the default table-based `ListView` is used with the `columns` defined above.
   *
   * @example
   * listView: DocsListView,
   */
  // listView: undefined,

  /**
   * Group name for organising this collection in the admin sidebar navigation.
   *
   * @example
   * group: 'Documentation',
   */
  // group: undefined,

  /**
   * Per-field rendering overrides, keyed by field name. Use to supply custom
   * UI component slots for a specific field without affecting placement.
   * Placement is controlled exclusively through the layout primitives below.
   */
  fields: {
    summary: {
      components: {
        HelpText: SummaryLength,
      },
    },
  },

  /**
   * Preview URL builder for live preview links. Receives the document and an
   * optional locale and should return a fully-qualified URL string.
   *
   * @example
   * preview: (doc, { locale }) => `https://example.com/${locale}/docs/${doc.fields.path}`
   */
  // preview: undefined,

  // ---------------------------------------------------------------------------
  // UI Layout
  //
  // Tab, row, and group containers control how fields are grouped and positioned
  // in the document edit view. Field names must match those defined in the
  // collection schema. Names for tabSets, rows, and groups must be unique and
  // must not collide with any schema field name (a startup error is thrown if
  // they do).
  // ---------------------------------------------------------------------------

  /**
   * Named tab sets. Each entry creates a separate tabbed interface in the edit
   * view. You can define more than one tab set, though a single set is sufficient
   * for most collections. Tab sets may only appear in `layout.main`.
   *
   * Each tab's `fields` array accepts schema field names, row names, and group names.
   * An optional `condition` function can show/hide a tab based on live form data.
   */
  tabSets: [
    {
      name: 'main',
      tabs: [
        {
          name: 'details',
          label: 'Details',
          fields: ['title', 'summary', 'featureImage', 'category', 'featured'],
        },
        {
          name: 'content',
          label: 'Content',
          fields: ['content'],
        },
        {
          name: 'reviews',
          label: 'Reviews & Links',
          fields: ['reviews', 'links'],
        },
      ],
    },
  ],

  /**
   * Named horizontal-row layouts. Fields listed inside a row are rendered
   * side-by-side (flex row) on desktop and stack vertically below the `sm`
   * breakpoint. Rows are leaf containers — they accept only schema field names.
   *
   * Reference a row by its `name` inside a tab's `fields`, a group's `fields`,
   * or directly in `layout.main` / `layout.sidebar`.
   */
  // rows: [],

  /**
   * Named labelled-fieldset clusters. Groups accept schema field names and row
   * names (not tabSets or nested groups). An optional `label` renders a heading
   * above the cluster.
   *
   * Reference a group by its `name` inside a tab's `fields` or directly in
   * `layout.main` / `layout.sidebar`.
   */
  // groups: [],

  /**
   * Composition of all layout primitives into the form's two render regions.
   *
   * - `main` — accepts tabSet names, group names, row names, and schema field names.
   * - `sidebar` — accepts group names, row names, and schema field names (no tabSets).
   *
   * When omitted entirely, the renderer synthesises a default that places every
   * schema field in `main` in declaration order.
   */
  layout: {
    main: ['main'],
    sidebar: ['publishedOn', 'availableLanguages'],
  },
})
