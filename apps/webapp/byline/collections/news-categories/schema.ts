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
  // Admin list-view quick-search. The collection list route's search box
  // matches these top-level text-store fields with substring queries (ILIKE, in
  // the Postgres adapter) against `store_text` — a lightweight "find the row I
  // mean" affordance that needs no indexing and no lifecycle hooks. Falls back
  // to `useAsTitle` when omitted; declared explicitly here for guidance.
  listSearch: ['name'],
  // Search-*provider* config (docs/05-reading-and-delivery/07-search.md) —
  // distinct from `listSearch` above. This drives the pluggable SearchProvider
  // (full-text search in @byline/search-postgres) and offers richer options:
  // per-field weighting/`boost`, `facets`, `filters`, and `zones`. Unlike
  // `listSearch`, `search` is inert on its own — it MUST be paired with index /
  // reindex / deindex document-lifecycle hooks that keep the provider index in
  // sync on create / update / publish / delete (see this collection's hooks).
  search: { body: ['name'] },
  useAsTitle: 'name',
  useAsPath: 'name',
  // Demonstration of `orderable: true` — short, finite, naturally ordered.
  // Editors can drag rows in the list view to set a canonical order; the
  // value persists on `byline_documents.order_key` without bumping the
  // document version. See docs/04-collections/index.md (Orderable collections).
  orderable: true,
  // Server-only lifecycle hooks are registered in ../server-hooks.ts.
  fields: [
    { name: 'name', label: 'Name', type: 'text', localized: true },
    { name: 'description', label: 'Description', type: 'textArea', localized: true },
  ],
})

export type NewsCategoryFields = CollectionFieldData<typeof NewsCategories>
