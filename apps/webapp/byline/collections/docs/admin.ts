/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type CollectionAdminConfig, type ColumnDefinition, defineAdmin } from '@byline/core'

import { FeaturedFormatter } from './components/feature-formatter.js'
import { Docs } from './schema.js'

// ---- Admin UI config (client-only, presentation concerns) ----

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

const docsColumns: ColumnDefinition[] = [
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
    formatter: (value) =>
      new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short', // <- short month text (locale-aware)
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
  },
]

export const DocsAdmin: CollectionAdminConfig = defineAdmin(Docs, {
  useAsTitle: 'title',
  columns: docsColumns,
  tabs: [
    { name: 'details', label: 'Details' },
    { name: 'content', label: 'Content' },
    { name: 'reviews', label: 'Reviews & Links' },
  ],
  fields: {
    // Details tab
    title: { tab: 'details' },
    summary: { tab: 'details' },
    path: { position: 'sidebar' },
    publishedOn: { position: 'sidebar' },
    featured: { position: 'sidebar' },
    availableLanguages: { position: 'sidebar' },
    // Content tab
    content: { tab: 'content' },
    // Reviews & Links tab
    reviews: { tab: 'reviews' },
    links: { tab: 'reviews' },
  },
})
