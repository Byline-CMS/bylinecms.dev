/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  type SetRoleAbilitiesResponse,
  setRoleAbilitiesCommand,
} from '@byline/admin/admin-permissions'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

export interface SetRoleAbilitiesInput {
  id: string
  abilities: string[]
}

export const setRoleAbilities = createServerFn({ method: 'POST' })
  .inputValidator((input: SetRoleAbilitiesInput) => input)
  .handler(async ({ data }): Promise<SetRoleAbilitiesResponse> => {
    const context = await getAdminRequestContext()
    return setRoleAbilitiesCommand(context, data, {
      store: bylineCore.adminStore!,
      abilities: bylineCore.abilities,
    })
  })
