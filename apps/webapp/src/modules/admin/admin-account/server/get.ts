/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AccountResponse, getAccountCommand } from '@byline/admin/admin-account'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

/**
 * Read the currently signed-in admin's full account row. Used by the
 * admin-account route loader to obtain the `vid` and the timestamp /
 * status fields that the slim `CurrentAdminUser` on route context
 * doesn't carry.
 */
export const getAccount = createServerFn({ method: 'GET' })
  .inputValidator((input?: Record<string, never>) => input ?? {})
  .handler(async ({ data }): Promise<AccountResponse> => {
    const context = await getAdminRequestContext()
    return getAccountCommand(context, data, { store: bylineCore.adminStore! })
  })
