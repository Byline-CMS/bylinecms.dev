/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerOnlyFn } from '@tanstack/react-start'

import type { CollectionFieldData } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'

import { PhotoBlock } from '~/blocks/photo-block'
import { RichTextBlock } from '~/blocks/richtext-block'
import { publishedOnField } from '~/fields/published-on-field'

// ---- Schema (server-safe, no UI concerns) ----

const loadHooks = createServerOnlyFn(() => import('./hooks.js'))

export const Pages = defineCollection({
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
  // Admin list-view quick-search. The collection list route's search box
  // matches these top-level text-store fields with substring queries (ILIKE, in
  // the Postgres adapter) against `store_text` — a lightweight "find the row I
  // mean" affordance that needs no indexing and no lifecycle hooks. Falls back
  // to `useAsTitle` when omitted; declared explicitly here for guidance.
  listSearch: ['title'],
  // Search-*provider* config (docs/05-reading-and-delivery/07-search.md) —
  // distinct from `listSearch` above. This drives the pluggable SearchProvider
  // (full-text search in @byline/search-postgres) and offers richer options:
  // per-field weighting/`boost`, `facets`, `filters`, and `zones`. Unlike
  // `listSearch`, `search` is inert on its own — it MUST be paired with index /
  // reindex / deindex document-lifecycle hooks that keep the provider index in
  // sync on create / update / publish / delete (see this collection's hooks).
  search: { body: ['title'] },
  useAsTitle: 'title',
  useAsPath: 'title',
  advertiseLocales: true, // Renders the available-locales sidebar widget.
  linksInEditor: true,
  // Server-only lifecycle hooks (L1 cache invalidation). The TanStack wrapper
  // removes the loader body and its import graph from the client build.
  // See ./hooks.ts and docs/04-collections/index.md.
  hooks: loadHooks,
  /**
   * Pages live at the site root (no `/pages/` prefix) and may be nested
   * under an `area` segment. Same composition rule used by the admin
   * preview button (`admin.tsx` delegates to this) and the richtext
   * embed walker that refreshes `document.path` on internal links.
   *
   * Returns a locale-agnostic root-relative path; the renderer prepends
   * the locale at request time. Returns `null` when no slug exists yet
   * (brand-new draft) so the embed walker / preview both fall back to
   * "no link available" rather than producing a broken URL.
   */
  buildDocumentPath: (doc, _ctx) => {
    if (!doc.path) return null
    const area = doc.fields?.area
    if (typeof area === 'string' && area !== 'root') {
      return `/${area}/${doc.path}`
    }
    return `/${doc.path}`
  },
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
    // hasMany relation demo — an ordered list of Media references rendered as
    // drag-reorderable summary tiles in the editor. See docs/04-collections/02-relationships.md.
    {
      name: 'gallery',
      label: 'Gallery',
      type: 'relation',
      targetCollection: 'media',
      displayField: 'title',
      hasMany: true,
      optional: true,
      helpText: 'An ordered list of media items. Drag to reorder; ✕ to remove.',
    },
    {
      name: 'area',
      label: 'Area',
      type: 'select',
      defaultValue: 'root',
      helpText: 'Select an area for this page',
      options: [
        { label: 'Root', value: 'root' },
        { label: 'About', value: 'about' },
        { label: 'Legal', value: 'legal' },
      ],
    },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      optional: true,
      blocks: [RichTextBlock, PhotoBlock],
    },
    publishedOnField,
  ],
})

export type PageFields = CollectionFieldData<typeof Pages>
