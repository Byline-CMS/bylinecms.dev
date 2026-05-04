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

export const DocsCategories = defineCollection({
  path: 'docs-categories',
  labels: {
    singular: 'Document Category',
    plural: 'Document Categories',
  },
  // Lookup collection — no editorial lifecycle. Saves go straight to
  // `published` and the form shows only Save / Close.
  workflow: SINGLE_STATUS_WORKFLOW,
  showStats: true,
  search: { fields: ['name'] },
  useAsTitle: 'name',
  useAsPath: 'name',
  fields: [
    { name: 'name', label: 'Name', type: 'text', localized: true },
    { name: 'description', label: 'Description', type: 'textArea', localized: true },
  ],
})

export type DocsCategoryFields = CollectionFieldData<typeof DocsCategories>
