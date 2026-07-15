/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { InferCollectionRegistry } from '@byline/core'

import type { CollectionFieldsByPath } from '../generated/collection-types.js'

import { Docs } from './docs/schema.js'
import { Media } from './media/schema.js'
import { News } from './news/schema.js'
import { NewsCategories } from './news-categories/schema.js'
import { Pages } from './pages/schema.js'

export const collections = [Docs, News, Pages, Media, NewsCategories] as const

export type InferredBylineCollections = InferCollectionRegistry<typeof collections>
export type BylineCollections = CollectionFieldsByPath
