/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminRoleResponse, getAdminRoleCommand } from '@byline/admin/admin-roles'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { bylineCore } from '../../integrations/byline-core.js'

export const getAdminRole = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<AdminRoleResponse> => {
    const context = await getAdminRequestContext()
    return getAdminRoleCommand(context, data, { store: bylineCore().adminStore! })
  })
