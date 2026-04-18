/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Collection definitions used by the storage benchmark harness.
 *
 * Kept deliberately isolated from `apps/webapp/byline/collections/` so
 * benchmark runs cannot accidentally collide with a real app's collections
 * registered in the same database. The paths `bench-articles` and
 * `bench-media` are treated as reserved for the harness.
 *
 * The article schema spans five of the seven store tables:
 *   text      — title, slug, summary (textArea)
 *   json      — body (richText)
 *   numeric   — views, rating
 *   datetime  — published_at
 *   boolean   — featured
 *   relation  — hero (→ bench-media)
 *
 * No `group`, `array`, or `blocks` structures: the goal is to stress the
 * top-level UNION ALL + reconstruct pipeline, not nested walker cost.
 * Structure performance can be added as a separate sweep later.
 */

import type { CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

export const BENCH_ARTICLES_PATH = 'bench-articles'
export const BENCH_MEDIA_PATH = 'bench-media'

export const BenchMedia: CollectionDefinition = {
  path: BENCH_MEDIA_PATH,
  labels: { singular: 'Bench Media', plural: 'Bench Media' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  search: { fields: ['title'] },
  useAsTitle: 'title',
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'path', type: 'text', label: 'Path' },
    { name: 'caption', type: 'textArea', label: 'Caption', optional: true },
  ],
}

export const BenchArticles: CollectionDefinition = {
  path: BENCH_ARTICLES_PATH,
  labels: { singular: 'Bench Article', plural: 'Bench Articles' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  search: { fields: ['title', 'summary'] },
  useAsTitle: 'title',
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'path', type: 'text', label: 'Path' },
    { name: 'slug', type: 'text', label: 'Slug' },
    { name: 'summary', type: 'textArea', label: 'Summary' },
    { name: 'body', type: 'richText', label: 'Body' },
    { name: 'views', type: 'integer', label: 'Views' },
    { name: 'rating', type: 'float', label: 'Rating' },
    { name: 'published_at', type: 'datetime', mode: 'datetime', label: 'Published At' },
    { name: 'featured', type: 'checkbox', label: 'Featured' },
    {
      name: 'hero',
      type: 'relation',
      label: 'Hero',
      targetCollection: BENCH_MEDIA_PATH,
      displayField: 'title',
      optional: true,
    },
  ],
}

export const benchCollections: CollectionDefinition[] = [BenchArticles, BenchMedia]
