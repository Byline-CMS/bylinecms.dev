/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionFieldData } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'

import { PhotoBlock } from '~/blocks/photo-block'
import { RichTextBlock } from '~/blocks/richtext-block'
import { availableLanguagesField } from '~/fields/available-languages-field.js'
import { publishedOnField } from '~/fields/published-on-field'

// ---- Schema (server-safe, no UI concerns) ----

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
  search: { fields: ['title'] },
  useAsTitle: 'title',
  useAsPath: 'title',
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
  linksInEditor: true,
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
    availableLanguagesField(),
  ],
})

export type PageFields = CollectionFieldData<typeof Pages>
