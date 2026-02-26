/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

import { formatSlug } from '../../utilities/format-slug.js'

// ---- Schema (server-safe, no UI concerns) ----

export const News: CollectionDefinition = {
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
