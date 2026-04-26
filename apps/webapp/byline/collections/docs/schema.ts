/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineCollection, defineWorkflow } from '@byline/core'

import { PhotoBlock } from '../../blocks/photo-block.js'
import { RichTextBlock } from '../../blocks/richtext-block.js'
import { availableLanguagesField } from '../../fields/available-languages-field.js'

// ---- Schema (server-safe, no UI concerns) ----

export const Docs = defineCollection({
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
  showStats: true,
  search: { fields: ['title'] },
  useAsTitle: 'title',
  useAsPath: 'title',
  linksInEditor: true, // See type definition for details.
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
      name: 'title',
      label: 'Title',
      type: 'text',
      localized: true,
      hooks: {
        // Advisory: flag leading whitespace without altering the value.
        beforeValidate: ({ value }) => {
          if (typeof value === 'string' && value !== value.trimStart()) {
            return { error: 'Title should not start with whitespace' }
          }
        },
      },
    },
    {
      name: 'summary',
      label: 'Summary',
      type: 'textArea',
      localized: true,
      helpText:
        'Enter a short summary. The first 150 characters are used for social media meta descriptions. Aim for 100–300 characters.',
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
      name: 'publishedOn',
      label: 'Published On',
      type: 'datetime',
      mode: 'datetime',
    },
    {
      name: 'category',
      label: 'Category',
      type: 'relation',
      targetCollection: 'categories',
      displayField: 'name',
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
      type: 'blocks',
      optional: true,
      blocks: [RichTextBlock, PhotoBlock],
    },
    {
      name: 'reviews',
      label: 'Reviews',
      type: 'array',
      optional: true,
      fields: [
        {
          name: 'reviewItem',
          label: 'Review Item',
          type: 'group',
          fields: [
            { name: 'rating', label: 'Rating', type: 'integer' },
            {
              name: 'comment',
              label: 'Comments',
              type: 'richText',
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
      optional: true,
      fields: [{ name: 'link', label: 'Link', type: 'text' }],
    },
    availableLanguagesField(),
  ],
})
