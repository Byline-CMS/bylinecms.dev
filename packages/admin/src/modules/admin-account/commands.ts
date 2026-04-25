/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import { requireAdminActor } from '../../lib/assert-admin-actor.js'
import { adminUserResponseSchema } from '../admin-users/schemas.js'
import {
  changeAccountPasswordRequestSchema,
  getAccountRequestSchema,
  updateAccountRequestSchema,
} from './schemas.js'
import { AdminAccountService } from './service.js'
import type { AdminStore } from '../../store.js'
import type { AccountResponse } from './schemas.js'

/**
 * Transport-agnostic commands for admin-account self-service.
 *
 * Same shape as the other admin module commands (`*-users`, `*-roles`,
 * `*-permissions`) with one deliberate difference: enforcement uses
 * `requireAdminActor` rather than `assertAdminActor`. There is no
 * ability key to gate against — the security property is "you may
 * only mutate your own row," and these commands enforce it
 * structurally by sourcing the target id from `actor.id` rather than
 * from the request payload. A request with an `id` field would have
 * no way to express "operate on someone else" because the schemas
 * don't accept one.
 */

export interface AdminAccountCommandDeps {
  store: AdminStore
}

function serviceOf(deps: AdminAccountCommandDeps): AdminAccountService {
  return new AdminAccountService({ repo: deps.store.adminUsers })
}

export async function getAccountCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminAccountCommandDeps
): Promise<AccountResponse> {
  // No-op parse — `getAccountRequestSchema` is `{}.strict()` so it
  // rejects stray payloads but yields no usable data. The schema is
  // validated for shape consistency with the other commands.
  getAccountRequestSchema.parse(input ?? {})
  const actor = requireAdminActor(context, 'reading own admin account')
  const result = await serviceOf(deps).getAccount(actor.id)
  return adminUserResponseSchema.parse(result)
}

export async function updateAccountCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminAccountCommandDeps
): Promise<AccountResponse> {
  const parsed = updateAccountRequestSchema.parse(input)
  const actor = requireAdminActor(context, 'updating own admin account')
  const result = await serviceOf(deps).updateAccount(actor.id, parsed)
  return adminUserResponseSchema.parse(result)
}

export async function changeAccountPasswordCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminAccountCommandDeps
): Promise<AccountResponse> {
  const parsed = changeAccountPasswordRequestSchema.parse(input)
  const actor = requireAdminActor(context, 'changing own admin password')
  const result = await serviceOf(deps).changePassword(actor.id, parsed)
  return adminUserResponseSchema.parse(result)
}
