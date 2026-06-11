/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AfterStoreContext, BeforeStoreContext, CollectionFieldData } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'

import { publishedOnField } from '~/fields/published-on-field.js'

// ---- Schema (server-safe, no UI concerns) ----

export const News = defineCollection({
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
  showStats: true,
  search: { fields: ['title'] },
  useAsTitle: 'title',
  useAsPath: 'title',
  advertiseLocales: true, // Renders the available-locales sidebar widget.
  linksInEditor: true, // See type definition for details.
  // Server-only lifecycle hooks (L1 cache invalidation), loaded via dynamic
  // import so their server-only graph never enters the client bundle. See
  // ./hooks.ts and docs/COLLECTIONS.md.
  hooks: () => import('./hooks.js'),
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    {
      name: 'summary',
      label: 'Summary',
      type: 'textArea',
      localized: true,
      helpText:
        'Enter a short summary. The first 150 characters are used for social media meta descriptions. Aim for 100–300 characters.',
    },
    {
      name: 'category',
      label: 'Category',
      type: 'relation',
      targetCollection: 'news-categories',
      displayField: 'name',
    },
    // Relation field demo. Points at the Media upload collection
    // so editors can choose a feature image via the relation picker widget.
    // Set `displayField: 'title'` so the picker's row label reads from the
    // uploaded item's `title` field rather than falling back to its path.
    // Will display the picker defined columns if present in the admin.tsx
    // configuration.
    {
      name: 'featureImage',
      label: 'Feature Image',
      type: 'relation',
      targetCollection: 'media',
      displayField: 'title',
      optional: true,
    },
    {
      name: 'attachment',
      label: 'Attachment',
      type: 'file',
      optional: true,
      helpText: 'Select an file to upload.',
      upload: {
        // Allow common types.
        mimeTypes: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        // 20 MB limit per file.
        maxFileSize: 20 * 1024 * 1024,
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
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
      optional: true,
      helpText: 'Feature this document.',
    },
    {
      name: 'content',
      label: 'Content',
      type: 'richText',
      helpText: 'Enter the main content for this page.',
      localized: true,
      embedRelationsOnSave: true, // See type definition for details.
    },
    publishedOnField,
  ],
})

/**
 * Field data shape inferred directly from the schema. Use this as the
 * generic to typed read calls — `client.collection('news').find<NewsFields>()`
 * — so dot-notation on `doc.fields` is fully checked.
 */
export type NewsFields = CollectionFieldData<typeof News>
