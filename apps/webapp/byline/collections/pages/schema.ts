/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

import { availableLanguagesField } from '~/fields/available-languages-field.js'

// ---- Schema (server-safe, no UI concerns) ----

export const Pages: CollectionDefinition = {
  path: 'pages',
  labels: {
    singular: 'Page',
    plural: 'Pages',
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
      name: 'category',
      label: 'Category',
      type: 'select',
      optional: true,
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
      localized: true,
    },
    {
      name: 'publishedOn',
      label: 'Published On',
      type: 'datetime',
      mode: 'datetime',
    },
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
      optional: true,
      helpText: 'Feature this page.',
    },
    availableLanguagesField(),
  ],
}
