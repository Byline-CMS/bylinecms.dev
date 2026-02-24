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

import { PhotoBlock } from '../../blocks/photo-block.js'
import { RichTextBlock } from '../../blocks/richtext-block.js'
import { formatSlug } from '../../utilities/format-slug.js'
import { FeaturedFormatter } from './components/feature-formatter.js'

// ---- Schema (server-safe, no UI concerns) ----

export const Docs: CollectionDefinition = {
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  // Workflow: defineWorkflow() guarantees draft, published, and archived are
  // always present and correctly ordered. Any additional statuses specified in
  // customStatuses are inserted between draft and published.
  //
  //   Resulting order: [draft, needs_review, published, archived]
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
    customStatuses: [{ name: 'needs_review', label: 'Needs Review', verb: 'Request Review' }],
  }),
  // All hooks can be a single function or an array of functions.
  // If an array is provided, the functions will be executed in sequence.
  hooks: {
    beforeCreate: async ({ data, collectionPath }) => {
      // Example: beforeCreate hook
      console.log(
        `beforeCreate: Creating a new document in collection ${collectionPath} with data:`,
        data
      )
    },
    afterCreate: async ({ data, collectionPath, documentId, documentVersionId }) => {
      // Example: log the creation of a new document.
      console.log(
        `afterCreate: Document created with ID ${documentId} and version ID ${documentVersionId} in collection ${collectionPath}`
      )
    },
    beforeUpdate: async ({ data, originalData, collectionPath }) => {
      // Example: prevent a document from being published if it doesn't have a title.
      console.log(
        `beforeUpdate: Updating a document in collection ${collectionPath} with data:`,
        data
      )
    },
    afterUpdate: async ({ data, originalData, collectionPath, documentId, documentVersionId }) => {
      // Example: log the update of a document.
      console.log(
        `afterUpdate: Document with ID ${documentId} and version ID ${documentVersionId} in collection ${collectionPath} was updated`
      )
    },
    beforeStatusChange: async ({
      documentId,
      documentVersionId,
      collectionPath,
      previousStatus,
      nextStatus,
    }) => {
      console.log(
        `beforeStatusChange: Changing status of document in collection ${collectionPath} from ${previousStatus} to ${nextStatus} with document ID ${documentId} and version ID ${documentVersionId}`
      )
    },
    afterStatusChange: async ({
      documentId,
      documentVersionId,
      collectionPath,
      previousStatus,
      nextStatus,
    }) => {
      console.log(
        `afterStatusChange: Status of document in collection ${collectionPath} changed from ${previousStatus} to ${nextStatus} with document ID ${documentId} and version ID ${documentVersionId}`
      )
    },
    beforeUnpublish: async ({ documentId, collectionPath }) => {
      console.log(
        `beforeUnpublish: Unpublishing document in collection ${collectionPath} with document ID ${documentId}.`
      )
    },
    afterUnpublish: async ({ documentId, collectionPath }) => {
      console.log(
        `afterUnpublish: Document in collection ${collectionPath} with document ID ${documentId} unpublished.`
      )
    },
    beforeDelete: async ({ documentId, collectionPath }) => {
      console.log(
        `beforeDelete: Deleting document in collection ${collectionPath} with document ID ${documentId}.`
      )
    },
    afterDelete: async ({ documentId, collectionPath }) => {
      console.log(
        `afterDelete: Document in collection ${collectionPath} with document ID ${documentId} deleted.`
      )
    },
  },
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
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      required: true,
      hooks: {
        // Advisory: flag leading whitespace without altering the value.
        beforeValidate: ({ value }) => {
          if (typeof value === 'string' && value !== value.trimStart()) {
            return { error: 'Title should not start with whitespace' }
          }
        },
      },
    },
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
      helpText: 'Feature this document.',
    },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
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
          type: 'composite',
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
    // Content tab
    content: { tab: 'content' },
    // Reviews & Links tab
    reviews: { tab: 'reviews' },
    links: { tab: 'reviews' },
  },
})
