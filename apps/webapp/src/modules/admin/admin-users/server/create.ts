/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminUserResponse, createAdminUserCommand } from '@byline/admin/admin-users'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

export interface CreateAdminUserInput {
  email: string
  password: string
  given_name?: string | null
  family_name?: string | null
  username?: string | null
  is_super_admin?: boolean
  is_enabled?: boolean
  is_email_verified?: boolean
}

export const createAdminUser = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateAdminUserInput) => input)
  .handler(async ({ data }): Promise<AdminUserResponse> => {
    const context = await getAdminRequestContext()
    return createAdminUserCommand(context, data, { store: bylineCore.adminStore! })
  })
