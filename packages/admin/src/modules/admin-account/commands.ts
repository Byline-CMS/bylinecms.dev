/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type Command, createCommand } from '../../lib/create-command.js'
import { adminUserResponseSchema } from '../admin-users/schemas.js'
import {
  changeAccountPasswordRequestSchema,
  getAccountRequestSchema,
  setPreferredLocaleRequestSchema,
  updateAccountRequestSchema,
} from './schemas.js'
import { AdminAccountService } from './service.js'
import type { AdminStore } from '../../store.js'
import type {
  AccountResponse,
  ChangeAccountPasswordRequest,
  GetAccountRequest,
  SetPreferredLocaleRequest,
  UpdateAccountRequest,
} from './schemas.js'

/**
 * Transport-agnostic commands for admin-account self-service.
 *
 * Same `createCommand` shape as the other admin modules, with one
 * deliberate difference: `auth` is `{ authenticated: true }` rather than
 * `{ ability }`. There is no ability key to gate against — the security
 * property is "you may only mutate your own row," enforced structurally
 * by sourcing the target id from `actor.id` rather than from the request
 * payload. The request schemas do not accept an `id` field, so a caller
 * has no way to express "operate on someone else."
 */

export interface AdminAccountCommandDeps {
  store: AdminStore
}

function serviceOf(deps: AdminAccountCommandDeps): AdminAccountService {
  return new AdminAccountService({ repo: deps.store.adminUsers })
}

export const getAccountCommand: Command<
  GetAccountRequest,
  AccountResponse,
  AdminAccountCommandDeps
> = createCommand({
  method: 'getAccount',
  auth: { authenticated: true },
  schemas: { input: getAccountRequestSchema, output: adminUserResponseSchema },
  handler: ({ deps, actor }) => serviceOf(deps).getAccount(actor.id),
})

export const updateAccountCommand: Command<
  UpdateAccountRequest,
  AccountResponse,
  AdminAccountCommandDeps
> = createCommand({
  method: 'updateAccount',
  auth: { authenticated: true },
  schemas: { input: updateAccountRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps, actor }) => serviceOf(deps).updateAccount(actor.id, input),
})

export const changeAccountPasswordCommand: Command<
  ChangeAccountPasswordRequest,
  AccountResponse,
  AdminAccountCommandDeps
> = createCommand({
  method: 'changeAccountPassword',
  auth: { authenticated: true },
  schemas: { input: changeAccountPasswordRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps, actor }) => serviceOf(deps).changePassword(actor.id, input),
})

export const setPreferredLocaleCommand: Command<
  SetPreferredLocaleRequest,
  AccountResponse,
  AdminAccountCommandDeps
> = createCommand({
  method: 'setPreferredLocale',
  auth: { authenticated: true },
  schemas: { input: setPreferredLocaleRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps, actor }) => serviceOf(deps).setPreferredLocale(actor.id, input.locale),
})
