/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineCollection, defineWorkflow } from '@byline/core'

/**
 * Minimal "articles" collection for integration tests.
 * Timestamp-suffixed path avoids collisions across test runs.
 */
export function createTestArticlesCollection(suffix: string | number = Date.now()) {
  return defineCollection({
    path: `test-articles-${suffix}`,
    labels: {
      singular: 'Article',
      plural: 'Articles',
    },
    workflow: defineWorkflow({
      draft: { label: 'Draft', verb: 'Revert to Draft' },
      published: { label: 'Published', verb: 'Publish' },
      archived: { label: 'Archived', verb: 'Archive' },
    }),
    search: { fields: ['title'] },
    // Slugify the title field into the document version's `path` column so
    // tests that exercise `findByPath` can resolve docs by a stable slug
    // without each test individually passing an explicit `path` override.
    useAsPath: 'title',
    fields: [
      { name: 'title', type: 'text', label: 'Title', localized: true },
      { name: 'path', type: 'text', label: 'Path' },
      { name: 'summary', type: 'textArea', label: 'Summary', localized: true },
      { name: 'views', type: 'integer', label: 'Views', optional: true },
      {
        name: 'featured',
        type: 'checkbox',
        label: 'Featured',
        optional: true,
      },
    ],
  })
}

/** Sample document data for seeding. */
export const sampleArticles = [
  {
    title: 'Getting Started with Byline',
    path: 'getting-started',
    summary: 'An introductory guide to Byline CMS.',
    views: 150,
    featured: true,
  },
  {
    title: 'Advanced Storage Patterns',
    path: 'advanced-storage',
    summary: 'Deep dive into EAV storage and the store manifest.',
    views: 42,
    featured: false,
  },
  {
    title: 'Building a Client API',
    path: 'building-client-api',
    summary: 'How the @byline/client package was designed.',
    views: 0,
    featured: false,
  },
]
