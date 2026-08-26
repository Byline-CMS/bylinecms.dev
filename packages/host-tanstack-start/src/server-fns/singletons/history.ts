/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminBylineClient } from '@byline/client/server'

import { type ActorLabelMap, resolveActorLabels } from '../actors.js'
import { serialise } from '../serialise.js'

export interface SingletonHistorySearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  locale?: string
}

export const getSingletonHistory = createServerFn({ method: 'GET' })
  .validator((input: { singleton: string; params?: SingletonHistorySearchParams }) => input)
  .handler(async ({ data }) => {
    const params = data.params ?? {}
    const result = await getAdminBylineClient()
      .singleton(data.singleton)
      .history({
        locale: params.locale ?? 'en',
        page: params.page,
        pageSize: params.page_size,
        order: params.order,
        desc: params.desc,
      })
    const actors: ActorLabelMap = await resolveActorLabels(
      result.docs.map((item) => item.createdBy)
    )
    return { ...serialise(result), actors }
  })
