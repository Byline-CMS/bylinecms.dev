/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  type ListRegisteredAbilitiesResponse,
  listRegisteredAbilitiesCommand,
} from '@byline/admin/admin-permissions'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { bylineCore } from '../../integrations/byline-core.js'

/**
 * List every registered ability — fed from `bylineCore().abilities`,
 * populated at init time by collection auto-registration plus
 * `registerAdminAbilities`. No DB read.
 */
export const listRegisteredAbilities = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ListRegisteredAbilitiesResponse> => {
    const context = await getAdminRequestContext()
    return listRegisteredAbilitiesCommand(
      context,
      {},
      {
        store: bylineCore().adminStore!,
        abilities: bylineCore().abilities,
      }
    )
  }
)
