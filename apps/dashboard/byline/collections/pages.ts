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

import type { CollectionDefinition } from '@byline/core'
import { type CollectionAdminConfig, type ColumnDefinition, defineAdmin } from '@byline/core'

// ---- Schema (server-safe, no UI concerns) ----

export const Pages: CollectionDefinition = {
  path: 'pages',
  labels: {
    singular: 'Page',
    plural: 'Pages',
  },
  fields: [
    { name: 'path', label: 'Path', type: 'text', required: true },
    { name: 'title', label: 'Title', type: 'text', required: true },
    {
      name: 'category',
      label: 'Category',
      type: 'select',
      helpText: 'Select a category for this page',
      options: [
        { label: 'Foo', value: 'foo' },
        { label: 'Bar', value: 'bar' },
        { label: 'Baz', value: 'baz' },
      ],
    },
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
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
      helpText: 'Is this page featured on the home page?',
    },
  ],
}

// ---- Admin UI config (client-only, presentation concerns) ----

const pagesColumns: ColumnDefinition[] = [
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
    formatter: (value) => (value ? '★' : ''),
  },
  {
    fieldName: 'published',
    label: 'Status',
    align: 'center',
    className: 'w-[15%]',
    formatter: (value) => (value ? 'Published' : 'Draft'),
  },
  {
    fieldName: 'updated_at',
    label: 'Last Updated',
    sortable: true,
    align: 'right',
    className: 'w-[20%]',
  },
]

export const PagesAdmin: CollectionAdminConfig = defineAdmin(Pages, {
  useAsTitle: 'title',
  columns: pagesColumns,
  fields: {
    path: { position: 'sidebar' },
    publishedOn: { position: 'sidebar' },
    featured: { position: 'sidebar' },
  },
})
