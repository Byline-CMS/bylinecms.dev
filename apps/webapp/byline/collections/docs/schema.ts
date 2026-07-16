/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionFieldData } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'

import { CodeBlock } from '../../blocks/code-block.js'
import { PhotoBlock } from '../../blocks/photo-block.js'
import { QuoteBlock } from '../../blocks/quote-block.js'
import { RichTextBlock } from '../../blocks/richtext-block.js'
import { publishedOnField } from '../../fields/published-on-field.js'

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
  // Document tree (docs/04-collections/03-document-trees.md): the docs collection is a
  // single-parent ordered hierarchy. Mutually exclusive with `orderable` —
  // the tree owns ordering (per-parent, on the edge), so `order_key` on
  // `byline_documents` is inert here. Sibling order and nesting are edited via
  // the sidebar tree-placement widget; the import script derives placement
  // from the source directory layout (see byline/scripts/import-docs.ts).
  tree: true,
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
  // Here: `title` (boosted — lands in tsvector weight class A) + `summary` feed
  // the full-text body. `title` is display-only unless listed here, so we list
  // it. `content` is a `blocks` field — buildSearchDocument walks it
  // recursively, flattening every nested richText/text leaf (RichTextBlock
  // prose, PhotoBlock alt + caption) into the searchable body.
  search: { body: [{ field: 'title', boost: 2 }, 'summary', 'content'] },
  useAsTitle: 'title',
  useAsPath: 'title',
  advertiseLocales: true, // Renders the available-locales sidebar widget.
  linksInEditor: true, // See type definition for details.
  // Server-only lifecycle hooks are registered in ../server-hooks.ts so this
  // schema remains portable across host frameworks and safe in client graphs.
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
    publishedOnField,
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      optional: true,
      blocks: [RichTextBlock, PhotoBlock, CodeBlock, QuoteBlock],
    },
  ],
})

export type DocFields = CollectionFieldData<typeof Docs>
