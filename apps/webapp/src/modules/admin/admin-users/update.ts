/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminUserResponse, updateAdminUserCommand } from '@byline/admin/admin-users'

import { getAdminRequestContext } from '@/lib/auth-context'
import { getAdminStore } from './admin-store'

export interface UpdateAdminUserInput {
  id: string
  vid: number
  patch: {
    email?: string
    given_name?: string | null
    family_name?: string | null
    username?: string | null
    is_super_admin?: boolean
    is_email_verified?: boolean
  }
}

export const updateAdminUser = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateAdminUserInput) => input)
  .handler(async ({ data }): Promise<AdminUserResponse> => {
    const context = await getAdminRequestContext()
    return updateAdminUserCommand(context, data, { store: getAdminStore() })
  })
