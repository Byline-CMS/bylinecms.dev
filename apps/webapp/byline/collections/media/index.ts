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

import { MediaThumbnailCell } from './components/media-thumbnail-cell.js'

// ---- Schema (server-safe, no UI concerns) ----

/**
 * Media — the reference upload collection.
 *
 * Any collection that includes an `upload` block is treated as a media
 * library by Byline CMS. An upload endpoint is automatically mounted at
 *   `POST /admin/api/<collection-path>/upload`
 *
 * Other collections reference items from this collection via a `relation`
 * field pointing at `'media'`.
 *
 * @example
 * ```ts
 * // In another collection's fields:
 * {
 *   name: 'featuredImage',
 *   label: 'Featured Image',
 *   type: 'relation',
 *   targetCollection: 'media',
 *   displayField: 'title',
 * }
 * ```
 */
export const Media: CollectionDefinition = {
  path: 'media',
  labels: {
    singular: 'Media Item',
    plural: 'Media',
  },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Active', verb: 'Activate' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  upload: {
    // Allow common image types. Extend with 'video/*', 'application/pdf' etc.
    // for a more general media collection.
    mimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/svg+xml',
    ],
    // 20 MB limit per file.
    maxFileSize: 20 * 1024 * 1024,
    // Named Sharp variants generated after upload.
    // Sizes are per-collection configuration — adjust to suit your layout needs.
    sizes: [
      {
        name: 'thumbnail',
        width: 400,
        height: 400,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      },
      {
        name: 'card',
        width: 600,
        fit: 'inside',
        format: 'webp',
        quality: 82,
      },
      {
        name: 'mobile',
        width: 768,
        fit: 'inside',
        format: 'webp',
        quality: 85,
      },
      {
        name: 'tablet',
        width: 1280,
        fit: 'inside',
        format: 'webp',
        quality: 85,
      },
      {
        name: 'desktop',
        width: 2100,
        fit: 'inside',
        format: 'webp',
        quality: 85,
      },
    ],
  },
  fields: [
    // The primary file/image field — this is what gets populated by the
    // upload endpoint. Treat as the "focal" field of the collection.
    {
      name: 'image',
      label: 'Image',
      type: 'image',
      required: true,
    },
    // Descriptive metadata fields.
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      required: true,
      helpText: 'A short, descriptive title for this media item.',
    },
    {
      name: 'altText',
      label: 'Alt Text',
      type: 'text',
      required: true,
      helpText: 'Descriptive text for screen readers and SEO. Recommended for images.',
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'textArea',
      required: false,
      helpText: 'Optional caption displayed beneath the image in the front-end.',
    },
    {
      name: 'credit',
      label: 'Credit / Attribution',
      type: 'text',
      required: false,
      helpText: 'Photographer, agency, or copyright holder.',
    },
  ],
}

// ---- Admin UI config (client-only, presentation concerns) ----

const mediaColumns: ColumnDefinition[] = [
  {
    fieldName: 'image' as keyof any,
    label: 'Preview',
    align: 'left',
    className: 'w-[5%]',
    formatter: { component: MediaThumbnailCell },
  },
  {
    fieldName: 'title',
    label: 'Title',
    sortable: true,
    align: 'left',
    className: 'w-[60%]',
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
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
  },
]

export const MediaAdmin: CollectionAdminConfig = defineAdmin(Media, {
  useAsTitle: 'title',
  columns: mediaColumns,
})
