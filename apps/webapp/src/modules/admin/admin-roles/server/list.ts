/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type AdminRoleListResponse, listAdminRolesCommand } from '@byline/admin/admin-roles'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

/**
 * List admin roles. Thin server-fn wrapper over `listAdminRolesCommand`
 * — validation, ability assertion, and shaping all live in the command.
 * No paging or sorting at this layer; the role set is small by design
 * and ordered by the `order` column.
 */
export const listAdminRoles = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminRoleListResponse> => {
    const context = await getAdminRequestContext()
    return listAdminRolesCommand(context, {}, { store: bylineCore.adminStore! })
  }
)
