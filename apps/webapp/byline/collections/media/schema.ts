/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AfterStoreContext, BeforeStoreContext, CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

// ---- Schema (server-safe, no UI concerns) ----

/**
 * Media — the reference upload collection.
 *
 * Upload-capability is declared on individual `image` / `file` fields via
 * an `upload` block. The auto-mounted endpoint at
 *   `POST /admin/api/<collection-path>/upload`
 * accepts a `field` selector to choose which upload-capable field
 * receives the file (default when only one such field exists).
 *
 * Other collections reference items from this collection via a `relation`
 * field pointing at `'media'` — the populated relation envelope carries
 * the persisted `variants` array so a `<picture>` / `srcset` can be built
 * without a second round-trip.
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
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Active', verb: 'Activate' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  showStats: true,
  search: { fields: ['title', 'caption'] },
  fields: [
    {
      name: 'image',
      label: 'Image',
      type: 'image',
      upload: {
        // Allow common image types. Extend with 'video/*', 'application/pdf'
        // etc. for a more general media field.
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
        // Named Sharp variants generated after the original is stored.
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
        hooks: {
          beforeStore: (ctx: BeforeStoreContext) => {
            console.log('beforeStore hook called', ctx)
          },
          afterStore: (ctx: AfterStoreContext) => {
            console.log('afterStore hook called', ctx)
          },
        },
      },
    },
    // Descriptive metadata fields.
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      helpText: 'A short, descriptive title for this media item.',
    },
    {
      name: 'altText',
      label: 'Alt Text',
      type: 'text',
      helpText: 'Descriptive text for screen readers and SEO. Recommended for images.',
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'textArea',
      optional: true,
      helpText: 'Optional caption displayed beneath the image in the front-end.',
    },
    {
      name: 'credit',
      label: 'Credit / Attribution',
      type: 'text',
      optional: true,
      helpText: 'Photographer, agency, or copyright holder.',
    },
  ],
}
