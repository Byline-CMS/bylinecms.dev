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
  search: { fields: ['title'] },
  useAsTitle: 'title',
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    {
      name: 'path',
      label: 'Path',
      type: 'text',
      hooks: {
        beforeValidate: formatSlug('title'),
      },
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
    // Relation field demo (Phase 3). Points at the Media upload collection
    // so editors can choose a hero image via the relation picker widget.
    // Set `displayField: 'title'` so the picker's row label reads from the
    // uploaded item's `title` field rather than falling back to its path.
    {
      name: 'heroImage',
      label: 'Hero Image',
      type: 'relation',
      targetCollection: 'media',
      displayField: 'title',
      optional: true,
    },
    availableLanguagesField(),
  ],
}
