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
  orderable: true,
  search: { fields: ['title'] },
  useAsTitle: 'title',
  useAsPath: 'title',
  advertiseLocales: true, // Renders the available-locales sidebar widget.
  linksInEditor: true, // See type definition for details.
  // Collection lifecycle hooks. Hooks run **server-side only**, but this
  // schema is isomorphic (also bundled into the browser admin), so we declare
  // the hooks via the **loader form** — a thunk that dynamically imports a
  // sibling module — rather than an inline object. Because the schema reaches
  // them only through `import()`, `./hooks.ts` and its entire import graph
  // stay out of the client bundle, leaving that file free to import any
  // server-only code (Node built-ins, DB clients, caches, secrets). See
  // `./hooks.ts` for the full explanation, and docs/COLLECTIONS.md →
  // "Hooks must not statically import server-only code".
  //
  // (Hooks that only touch isomorphic code may still be declared inline as
  // `hooks: { … }`; the loader form is what makes server-only imports safe.)
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
