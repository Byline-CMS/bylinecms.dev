/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { reorderAdminRolesCommand } from '@byline/admin/admin-roles'
import { getAdminRequestContext } from '@byline/client/server'

import { bylineCore } from '../../integrations/byline-core.js'
import { adminSessionMiddleware } from '../../integrations/session-middleware.js'

export const reorderAdminRoles = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator((input: { ids: string[] }) => input)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const context = await getAdminRequestContext()
    return reorderAdminRolesCommand(context, data, { store: bylineCore().adminStore! })
  })
