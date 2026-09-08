/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminBylineClient } from '@byline/client/server'

import { adminSessionMiddleware } from '../../integrations/session-middleware.js'
import { withDocumentMutationErrors } from '../document-mutation-errors.js'
import { serialise } from '../serialise.js'

export const confirmSingletonScheduledPublish = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(
    (input: { expectedRevision: number; singleton: string; expectedVersionId: string }) => input
  )
  .handler(
    withDocumentMutationErrors(async ({ data }) =>
      serialise(
        await getAdminBylineClient().singleton(data.singleton).confirmScheduledPublish({
          expectedRevision: data.expectedRevision,
          expectedVersionId: data.expectedVersionId,
        })
      )
    )
  )
