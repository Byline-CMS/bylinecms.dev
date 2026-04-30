/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { deleteAdminRoleCommand } from '@byline/admin/admin-roles'

import { getAdminRequestContext } from '@/integrations/byline/auth-context'
import { bylineCore } from '../../../../../byline.server.config.js'

// Return shape mirrors `OkResponse` from `@byline/admin/admin-users`.
// Lifting the type to a shared spot is a small follow-up — the two
// modules each declare their own identical `OkResponse` today, and the
// root `@byline/admin` barrel can only re-export one of them.
export const deleteAdminRole = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; vid: number }) => input)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const context = await getAdminRequestContext()
    return deleteAdminRoleCommand(context, data, { store: bylineCore.adminStore! })
  })
