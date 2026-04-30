/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { deleteAdminUserCommand, type OkResponse } from '@byline/admin/admin-users'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { bylineCore } from '../../integrations/byline-core.js'

export const deleteAdminUser = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; vid: number }) => input)
  .handler(async ({ data }): Promise<OkResponse> => {
    const context = await getAdminRequestContext()
    return deleteAdminUserCommand(context, data, { store: bylineCore().adminStore! })
  })
