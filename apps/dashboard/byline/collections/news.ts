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

export const News: CollectionDefinition = {
  path: 'news',
  labels: {
    singular: 'News',
    plural: 'News',
  },
  fields: [
    { name: 'path', label: 'Path', type: 'text', required: true },
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

export const NewsAdmin: CollectionAdminConfig = defineAdmin(News, {
  useAsTitle: 'title',
  columns: newsColumns,
  fields: {
    path: { position: 'sidebar' },
    publishedOn: { position: 'sidebar' },
  },
})
