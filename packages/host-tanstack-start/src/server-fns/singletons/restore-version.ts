/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminBylineClient } from '@byline/client/server'

import { toCommittedDocumentHookFailureResponse } from '../collections/save-outcome.js'
import { serialise } from '../serialise.js'

export const restoreSingletonVersion = createServerFn({ method: 'POST' })
  .validator((input: { expectedRevision: number; singleton: string; versionId: string }) => input)
  .handler(async ({ data }) => {
    try {
      return serialise(
        await getAdminBylineClient()
          .singleton(data.singleton)
          .restoreVersion(data.versionId, { expectedRevision: data.expectedRevision })
      )
    } catch (error) {
      const committedFailure = toCommittedDocumentHookFailureResponse(error)
      if (committedFailure != null) return committedFailure
      throw error
    }
  })
