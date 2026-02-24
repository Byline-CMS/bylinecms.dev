/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import {
  type CollectionAdminConfig,
  type ColumnDefinition,
  defineAdmin,
  defineWorkflow,
} from '@byline/core'

import { formatSlug } from '../../utilities/format-slug.js'

// ---- Schema (server-safe, no UI concerns) ----

export const News: CollectionDefinition = {
  path: 'news',
  labels: {
    singular: 'News',
    plural: 'News',
  },
  // Workflow: defineWorkflow() guarantees draft, published, and archived are
  // always present and correctly ordered. No custom statuses here — the
  // standard three-step lifecycle is used.
  //
  //   Resulting order: [draft, published, archived]
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  fields: [
    {
      name: 'path',
      label: 'Path',
      type: 'text',
      required: true,
      hooks: {
        beforeValidate: formatSlug('title'),
      },
    },
    { name: 'title', label: 'Title', type: 'text', required: true },
    {
      name: 'content',
      label: 'Content',
      type: 'richText',
      helpText: 'Enter the main content for this page.',
      required: true,
    },
    {
      name: 'publishedOn',
      label: 'Published On',
      type: 'datetime',
      mode: 'datetime',
      required: true,
    },
  ],
}

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

const newsColumns: ColumnDefinition[] = [
  {
    fieldName: 'title',
    label: 'Title',
    sortable: true,
    align: 'left',
    className: 'w-[25%]',
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

export const NewsAdmin: CollectionAdminConfig = defineAdmin(News, {
  useAsTitle: 'title',
  columns: newsColumns,
  fields: {
    path: { position: 'sidebar' },
    publishedOn: { position: 'sidebar' },
  },
})
