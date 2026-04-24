/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { type OkResponse, setAdminUserPasswordCommand } from '@byline/admin/admin-users'

import { getAdminRequestContext } from '@/lib/auth-context'
import { getAdminStore } from './admin-store'

export interface SetAdminUserPasswordInput {
  id: string
  vid: number
  password: string
}

export const setAdminUserPassword = createServerFn({ method: 'POST' })
  .inputValidator((input: SetAdminUserPasswordInput) => input)
  .handler(async ({ data }): Promise<OkResponse> => {
    const context = await getAdminRequestContext()
    return setAdminUserPasswordCommand(context, data, { store: getAdminStore() })
  })
