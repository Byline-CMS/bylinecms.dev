/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminBylineClient } from '@byline/client/server'
import type { SingletonSavePrecondition } from '@byline/core'

import { toCommittedDocumentHookFailureResponse } from '../collections/save-outcome.js'
import { serialise } from '../serialise.js'

export type UpdateSingletonInput = SingletonSavePrecondition & {
  singleton: string
  data: Record<string, any>
  locale?: string
}

export const updateSingleton = createServerFn({ method: 'POST' })
  .validator((input: UpdateSingletonInput) => input)
  .handler(async ({ data }) => {
    const { singleton, data: fields, locale, ...precondition } = data
    try {
      const result = await getAdminBylineClient()
        .singleton(singleton)
        .update(fields, {
          locale,
          ...precondition,
        })
      return serialise(result)
    } catch (error) {
      const committedFailure = toCommittedDocumentHookFailureResponse(error)
      if (committedFailure != null) return committedFailure
      throw error
    }
  })
