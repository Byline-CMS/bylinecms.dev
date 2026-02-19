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

import { PhotoBlock } from '../blocks/photo-block.js'
import { RichTextBlock } from '../blocks/richtext-block.js'

// ---- Schema (server-safe, no UI concerns) ----

export const Docs: CollectionDefinition = {
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  fields: [
    { name: 'path', label: 'Path', type: 'text', required: true },
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'summary', label: 'Summary', type: 'textArea', required: true, localized: true },
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
    {
      name: 'content',
      label: 'Content',
      type: 'array',
      fields: [RichTextBlock, PhotoBlock],
    },
    {
      name: 'reviews',
      label: 'Reviews',
      type: 'array',
      fields: [
        {
          name: 'reviewItem',
          label: 'Review Item',
          type: 'array',
          fields: [
            { name: 'rating', label: 'Rating', type: 'integer', required: true },
            {
              name: 'comment',
              label: 'Comments',
              type: 'richText',
              required: true,
              localized: false,
            },
          ],
        },
      ],
    },
    {
      name: 'links',
      label: 'Links',
      type: 'array',
      fields: [{ name: 'link', label: 'Link', type: 'text' }],
    },
  ],
}

// ---- Admin UI config (client-only, presentation concerns) ----

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
    formatter: (value) => (value ? '★' : ''),
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
  },
]

export const DocsAdmin: CollectionAdminConfig = defineAdmin(Docs, {
  useAsTitle: 'title',
  columns: docsColumns,
  fields: {
    path: { position: 'sidebar' },
    publishedOn: { position: 'sidebar' },
    featured: { position: 'sidebar' },
  },
})
