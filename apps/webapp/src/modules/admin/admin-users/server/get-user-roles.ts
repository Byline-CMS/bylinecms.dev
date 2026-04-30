/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getRolesForUserCommand, type UserRolesResponse } from '@byline/admin/admin-roles'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

export const getUserRoles = createServerFn({ method: 'GET' })
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data }): Promise<UserRolesResponse> => {
    const context = await getAdminRequestContext()
    return getRolesForUserCommand(context, data, { store: bylineCore.adminStore! })
  })
