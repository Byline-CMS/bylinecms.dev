/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionFieldData } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'

import { PhotoBlock } from '../../blocks/photo-block.js'
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
  // the sidebar tree-placement widget; the import script can also derive
  // placement from the source directory layout (see
  // byline/scripts/import-docs.ts --tree).
  tree: true,
  // Admin list-view quick-search. The collection list route's search box
  // matches these top-level text-store fields with substring queries (ILIKE, in
  // the Postgres adapter) against `store_text` — a lightweight "find the row I
  // mean" affordance that needs no indexing and no lifecycle hooks. Falls back
  // to `useAsTitle` when omitted; declared explicitly here for guidance.
  listSearch: ['title'],
  // Search-*provider* config (docs/05-reading-and-delivery/07-search.md) —
  // distinct from `listSearch` above. Each key names the part a field plays in
  // the index: `body` fields feed the full-text search vector (`title` is
  // display-only unless listed here, so we include it and boost it into the
  // heaviest weight class); `facets`, `filters`, and `zones` round out the
  // surface. This drives the pluggable SearchProvider (full-text search in
  // @byline/search-postgres) and requires a `search` provider registered in
  // byline/server.config.ts. Unlike `listSearch`, `search` is inert on its own
  // — opting in here is what makes the index / reindex / deindex lifecycle
  // hooks in ./hooks.ts keep this collection's provider index in sync.
  // `content` is a container (blocks) field: naming it walks every text-bearing
  // child (richtext body, image alt + caption) into the searchable body —
  // omit it and document bodies are silently absent from the index.
  search: { body: [{ field: 'title', boost: 2 }, 'summary', 'content'] },
  useAsTitle: 'title',
  useAsPath: 'title',
  advertiseLocales: true, // Renders the available-locales sidebar widget.
  linksInEditor: true, // See type definition for details.
  // Collection lifecycle hooks. Hook *bodies* only ever run server-side, but
  // a collection *schema* is isomorphic — Byline bundles it into the browser
  // admin too (the admin reads field config from it), so anything the schema
  // *statically imports* ships to the client. Search indexing needs a
  // server-only import (`getSystemBylineClient` from
  // `@byline/host-tanstack-start`), which would crash the browser bundle if
  // imported here. The **loader form** — a thunk that dynamically imports a
  // sibling module — keeps `./hooks.ts` and its entire import graph out of
  // the client bundle while running exactly like inline hooks on the server.
  // See ./hooks.ts for the worked example and the full explanation.
  hooks: () => import('./hooks.js'),
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
      blocks: [RichTextBlock, PhotoBlock],
    },
  ],
})

export type DocFields = CollectionFieldData<typeof Docs>
