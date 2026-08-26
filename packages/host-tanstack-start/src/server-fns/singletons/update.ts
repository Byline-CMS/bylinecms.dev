/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminBylineClient } from '@byline/client/server'

import { serialise } from '../serialise.js'

export interface UpdateSingletonInput {
  singleton: string
  data: Record<string, any>
  locale?: string
  expectedVersionId?: string
}

export const updateSingleton = createServerFn({ method: 'POST' })
  .validator((input: UpdateSingletonInput) => input)
  .handler(async ({ data }) => {
    const { singleton, data: fields, locale, expectedVersionId } = data
    const result = await getAdminBylineClient().singleton(singleton).update(fields, {
      locale,
      expectedVersionId,
    })
    return serialise(result)
  })
