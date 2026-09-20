/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionFieldData } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'

// ---- Schema (server-safe, no UI concerns) ----

/**
 * Videos — the reference upload collection for self-hosted video.
 *
 * Two upload-capable fields sit side by side, which is the point of the
 * example: `file` takes the encoded video, and `poster` takes a still image
 * that the player shows before playback starts. The auto-mounted endpoint at
 *   `POST /admin/api/videos/upload`
 * therefore needs its `field` selector to say which of the two receives a
 * given file.
 *
 * `videoBlock` references this collection through a `relation` field, and can
 * reference a second document as a lower-resolution mobile source.
 */
export const Videos = defineCollection({
  path: 'videos',
  labels: {
    singular: 'Video',
    plural: 'Videos',
  },
  useAsTitle: 'alt',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Active', verb: 'Activate' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  showStats: true,
  listSearch: ['alt'],
  fields: [
    {
      name: 'file',
      label: 'Video File',
      type: 'file',
      helpText: 'The encoded video served by the player.',
      upload: {
        mimeTypes: ['video/*'],
        // 500 MB limit per file. Self-hosting video without a streaming
        // service means the whole file is served from storage, so keep an
        // eye on what editors upload.
        maxFileSize: 500 * 1024 * 1024,
      },
    },
    {
      name: 'poster',
      label: 'Poster',
      type: 'image',
      helpText:
        'Placeholder image shown before playback starts. Use a frame from the video so the poster matches its aspect ratio — anything else letterboxes inside the player.',
      upload: {
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
        // 20 MB limit per file.
        maxFileSize: 20 * 1024 * 1024,
        /**
         * Two jobs, two formats.
         *
         * `thumbnail` and `card` feed admin lists, the relation picker, and
         * front-end list views, where `ResponsiveImage` emits AVIF with a
         * WebP fallback — so AVIF is free there.
         *
         * `poster` feeds the `<video poster>` attribute, which takes a single
         * URL and cannot negotiate format: an AVIF poster renders as nothing
         * on a client without AVIF support (Safari below 16.4). That one
         * variant is therefore WebP, sized to cover a 920px player at 2x
         * without serving the full-resolution original.
         *
         * Only `thumbnail` crops. Every other variant is `fit: 'inside'` and
         * preserves the uploaded aspect ratio.
         */
        sizes: [
          {
            name: 'thumbnail',
            width: 400,
            height: 400,
            fit: 'cover',
            format: 'avif',
            quality: 55,
          },
          { name: 'card', width: 600, fit: 'inside', format: 'avif', quality: 55 },
          { name: 'mobile', width: 768, fit: 'inside', format: 'avif', quality: 55 },
          { name: 'poster', width: 1600, fit: 'inside', format: 'webp', quality: 80 },
        ],
      },
    },
    {
      name: 'alt',
      label: 'Alt Text',
      type: 'text',
      helpText: 'Describes the video for assistive technology, and titles it in the admin.',
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'richText',
      localized: true,
      optional: true,
      helpText: 'Shown below the player unless the block overrides it.',
    },
  ],
})

export type VideoFields = CollectionFieldData<typeof Videos>
