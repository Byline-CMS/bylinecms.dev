/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News Categories list server fn — the TanStack Start boundary only.
 * The actual read (Byline viewer SDK) lives in `./categories.server`, loaded
 * with a dynamic `import()` inside the handler so the server-only SDK never
 * enters the client bundle. See `../pages/details` for the full rationale.
 */

import { createServerFn } from '@tanstack/react-start'

import type { FindResult } from '@byline/client'

import type { NewsCategoriesFields as NewsCategoryFields } from '~/generated/collection-types.js'

export type NewsCategoriesListResult = FindResult<NewsCategoryFields>

export interface NewsCategoriesListInput {
  lng?: string
}

export const getNewsCategoriesFn = createServerFn({ method: 'GET' })
  .validator(
    (input: NewsCategoriesListInput | undefined): NewsCategoriesListInput => ({
      lng: input?.lng,
    })
  )
  .handler(async (ctx): Promise<NewsCategoriesListResult> => {
    const { getNewsCategories } = await import('./categories.server')
    return getNewsCategories(ctx.data as NewsCategoriesListInput)
  })
