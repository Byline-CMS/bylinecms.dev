/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News Categories list server fn.
 *
 * Reads the `news-categories` collection through the shared *viewer*
 * `BylineClient`, mirroring the preview-aware status handling used by
 * `./list.ts`. Used to populate the category filter Select on the public
 * news index page.
 */

import { createServerFn } from '@tanstack/react-start'

import type { FindResult } from '@byline/client'
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

export type NewsCategoriesListResult = FindResult<NewsCategoryFields>

export interface NewsCategoriesListInput {
  lng?: string
}

export const getNewsCategoriesFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: NewsCategoriesListInput | undefined): NewsCategoriesListInput => ({
      lng: input?.lng,
    })
  )
  .handler(async (ctx): Promise<NewsCategoriesListResult> => {
    const { lng } = ctx.data as NewsCategoriesListInput
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('news-categories').find<NewsCategoryFields>({
      sort: { name: 'asc' },
      pageSize: 200,
      locale: lng,
      status: preview ? 'any' : 'published',
    })
  })
