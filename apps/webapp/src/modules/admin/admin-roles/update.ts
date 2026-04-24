/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminRoleResponse, updateAdminRoleCommand } from '@byline/admin/admin-roles'

import { getAdminRequestContext } from '@/lib/auth-context'
import { bylineCore } from '../../../../byline.server.config.js'

export interface UpdateAdminRoleInput {
  id: string
  vid: number
  patch: {
    name?: string
    description?: string | null
    order?: number
  }
}

export const updateAdminRole = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateAdminRoleInput) => input)
  .handler(async ({ data }): Promise<AdminRoleResponse> => {
    const context = await getAdminRequestContext()
    return updateAdminRoleCommand(context, data, { store: bylineCore.adminStore! })
  })
