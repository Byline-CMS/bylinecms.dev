/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  type AdminUserListOrder,
  type AdminUserListResponse,
  listAdminUsersCommand,
} from '@byline/admin/admin-users'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { bylineCore } from '../../integrations/byline-core.js'

export interface ListAdminUsersInput {
  page?: number
  pageSize?: number
  query?: string
  order?: AdminUserListOrder
  desc?: boolean
}

/**
 * List admin users. Thin server-fn wrapper over `listAdminUsersCommand`
 * — validation, ability assertion, and shaping all live in the command.
 * The wrapper's job is to resolve the request context from session
 * cookies, pass the `AdminStore` in, and let errors propagate to the
 * TanStack Start transport layer for the client to branch on.
 */
export const listAdminUsers = createServerFn({ method: 'GET' })
  .inputValidator((input: ListAdminUsersInput) => input ?? {})
  .handler(async ({ data }): Promise<AdminUserListResponse> => {
    const context = await getAdminRequestContext()
    return listAdminUsersCommand(context, data, { store: bylineCore().adminStore! })
  })
