/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

// ---- Schema (server-safe, no UI concerns) ----

export const DocsCategories: CollectionDefinition = {
  path: 'docs-categories',
  labels: {
    singular: 'Document Category',
    plural: 'Document Categories',
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
  search: { fields: ['name'] },
  useAsTitle: 'name',
  useAsPath: 'name',
  fields: [
    { name: 'name', label: 'Name', type: 'text', localized: true },
    { name: 'description', label: 'Description', type: 'textArea', localized: true },
  ],
}
