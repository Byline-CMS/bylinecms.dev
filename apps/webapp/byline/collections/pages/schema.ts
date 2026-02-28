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
import { formatSlug } from '../../utilities/format-slug.js'

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
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true, localized: true },
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
      localized: true,
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
      helpText: 'Feature this page.',
    },
    availableLanguagesField(),
  ],
}
