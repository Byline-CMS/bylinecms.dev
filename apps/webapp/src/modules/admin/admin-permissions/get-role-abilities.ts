/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  type GetRoleAbilitiesResponse,
  getRoleAbilitiesCommand,
} from '@byline/admin/admin-permissions'

import { getAdminRequestContext } from '@/lib/auth-context'
import { bylineCore } from '../../../../byline.server.config.js'

export const getRoleAbilities = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<GetRoleAbilitiesResponse> => {
    const context = await getAdminRequestContext()
    return getRoleAbilitiesCommand(context, data, {
      store: bylineCore.adminStore!,
      abilities: bylineCore.abilities,
    })
  })
