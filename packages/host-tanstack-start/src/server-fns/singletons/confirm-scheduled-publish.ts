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

export const confirmSingletonScheduledPublish = createServerFn({ method: 'POST' })
  .validator((input: { singleton: string; expectedVersionId: string }) => input)
  .handler(async ({ data }) =>
    serialise(
      await getAdminBylineClient()
        .singleton(data.singleton)
        .confirmScheduledPublish({ expectedVersionId: data.expectedVersionId })
    )
  )
