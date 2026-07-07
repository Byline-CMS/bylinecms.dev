/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionFieldData } from '@byline/core'
import { defineCollection, SINGLE_STATUS_WORKFLOW } from '@byline/core'

// ---- Schema (server-safe, no UI concerns) ----

export const NewsCategories = defineCollection({
  path: 'news-categories',
  labels: {
    singular: 'News Category',
    plural: 'News Categories',
  },
  // Lookup collection — no editorial lifecycle. Saves go straight to
  // `published` and the form shows only Save / Close.
  workflow: SINGLE_STATUS_WORKFLOW,
  showStats: true,
  search: { body: ['name'] },
  useAsTitle: 'name',
  useAsPath: 'name',
  // Demonstration of `orderable: true` — short, finite, naturally ordered.
  // Editors can drag rows in the list view to set a canonical order; the
  // value persists on `byline_documents.order_key` without bumping the
  // document version. See docs/04-collections/index.md (Orderable collections).
  orderable: true,
  // Server-only lifecycle hooks (L1 cache invalidation), loaded via dynamic
  // import so their server-only graph never enters the client bundle. See
  // ./hooks.ts and docs/04-collections/index.md.
  hooks: () => import('./hooks.js'),
  fields: [
    { name: 'name', label: 'Name', type: 'text', localized: true },
    { name: 'description', label: 'Description', type: 'textArea', localized: true },
  ],
})

export type NewsCategoryFields = CollectionFieldData<typeof NewsCategories>
