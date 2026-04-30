/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminUserResponse, getAdminUserCommand } from '@byline/admin/admin-users'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

export const getAdminUser = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<AdminUserResponse> => {
    const context = await getAdminRequestContext()
    return getAdminUserCommand(context, data, { store: bylineCore.adminStore! })
  })
