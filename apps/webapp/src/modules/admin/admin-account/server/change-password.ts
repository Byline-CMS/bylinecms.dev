/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AccountResponse, changeAccountPasswordCommand } from '@byline/admin/admin-account'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

export interface ChangeAccountPasswordInput {
  vid: number
  currentPassword: string
  newPassword: string
}

export const changeAccountPassword = createServerFn({ method: 'POST' })
  .inputValidator((input: ChangeAccountPasswordInput) => input)
  .handler(async ({ data }): Promise<AccountResponse> => {
    const context = await getAdminRequestContext()
    return changeAccountPasswordCommand(context, data, { store: bylineCore.adminStore! })
  })
