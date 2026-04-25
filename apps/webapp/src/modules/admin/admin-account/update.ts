/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AccountResponse, updateAccountCommand } from '@byline/admin/admin-account'

import { getAdminRequestContext } from '@/lib/auth-context'
import { bylineCore } from '../../../../byline.server.config.js'

export interface UpdateAccountInput {
  vid: number
  patch: {
    email?: string
    given_name?: string | null
    family_name?: string | null
    username?: string | null
  }
}

export const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateAccountInput) => input)
  .handler(async ({ data }): Promise<AccountResponse> => {
    const context = await getAdminRequestContext()
    return updateAccountCommand(context, data, { store: bylineCore.adminStore! })
  })
