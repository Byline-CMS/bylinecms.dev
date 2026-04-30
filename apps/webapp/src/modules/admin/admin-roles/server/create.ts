/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminRoleResponse, createAdminRoleCommand } from '@byline/admin/admin-roles'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

export interface CreateAdminRoleInput {
  name: string
  machine_name: string
  description?: string | null
  order?: number
}

export const createAdminRole = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateAdminRoleInput) => input)
  .handler(async ({ data }): Promise<AdminRoleResponse> => {
    const context = await getAdminRequestContext()
    return createAdminRoleCommand(context, data, { store: bylineCore.adminStore! })
  })
