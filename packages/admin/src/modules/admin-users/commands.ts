/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type Command, createCommand } from '../../lib/create-command.js'
import { ADMIN_USERS_ABILITIES } from './abilities.js'
import {
  adminUserListResponseSchema,
  adminUserResponseSchema,
  createAdminUserRequestSchema,
  deleteAdminUserRequestSchema,
  disableAdminUserRequestSchema,
  enableAdminUserRequestSchema,
  getAdminUserRequestSchema,
  listAdminUsersRequestSchema,
  okResponseSchema,
  setAdminUserPasswordRequestSchema,
  updateAdminUserRequestSchema,
} from './schemas.js'
import { AdminUsersService } from './service.js'
import type { AdminStore } from '../../store.js'
import type {
  AdminUserListResponse,
  AdminUserResponse,
  CreateAdminUserRequest,
  DeleteAdminUserRequest,
  DisableAdminUserRequest,
  EnableAdminUserRequest,
  GetAdminUserRequest,
  ListAdminUsersRequest,
  OkResponse,
  SetAdminUserPasswordRequest,
  UpdateAdminUserRequest,
} from './schemas.js'

/**
 * Transport-agnostic commands for the admin-users module.
 *
 * Each command is built through `createCommand`, which folds the four
 * standard steps (Zod-validate input → assert admin actor + ability →
 * call the service → Zod-validate output) into a single declaration.
 * The wrapper preserves the historical `(context, input, deps)` call
 * signature so server fns keep working without change.
 *
 * The `deps` argument holds the `AdminStore`. The webapp wraps these in
 * server fns that supply `deps` from the application's singleton store;
 * scripts and tests construct their own store and pass it in directly.
 */

export interface AdminUsersCommandDeps {
  store: AdminStore
}

function serviceOf(deps: AdminUsersCommandDeps): AdminUsersService {
  return new AdminUsersService({ repo: deps.store.adminUsers })
}

export const listAdminUsersCommand: Command<
  ListAdminUsersRequest,
  AdminUserListResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'listAdminUsers',
  auth: { ability: ADMIN_USERS_ABILITIES.read },
  schemas: { input: listAdminUsersRequestSchema, output: adminUserListResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).listUsers(input),
})

export const getAdminUserCommand: Command<
  GetAdminUserRequest,
  AdminUserResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'getAdminUser',
  auth: { ability: ADMIN_USERS_ABILITIES.read },
  schemas: { input: getAdminUserRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).getUser(input),
})

export const createAdminUserCommand: Command<
  CreateAdminUserRequest,
  AdminUserResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'createAdminUser',
  auth: { ability: ADMIN_USERS_ABILITIES.create },
  schemas: { input: createAdminUserRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).createUser(input),
})

export const updateAdminUserCommand: Command<
  UpdateAdminUserRequest,
  AdminUserResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'updateAdminUser',
  auth: { ability: ADMIN_USERS_ABILITIES.update },
  schemas: { input: updateAdminUserRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).updateUser(input),
})

export const setAdminUserPasswordCommand: Command<
  SetAdminUserPasswordRequest,
  AdminUserResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'setAdminUserPassword',
  auth: { ability: ADMIN_USERS_ABILITIES.changePassword },
  schemas: { input: setAdminUserPasswordRequestSchema, output: adminUserResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).setPassword(input),
})

export const enableAdminUserCommand: Command<
  EnableAdminUserRequest,
  OkResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'enableAdminUser',
  auth: { ability: ADMIN_USERS_ABILITIES.update },
  schemas: { input: enableAdminUserRequestSchema, output: okResponseSchema },
  handler: async ({ input, deps }) => {
    await serviceOf(deps).enableUser(input)
    return { ok: true } as const
  },
})

export const disableAdminUserCommand: Command<
  DisableAdminUserRequest,
  OkResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'disableAdminUser',
  auth: { ability: ADMIN_USERS_ABILITIES.update },
  schemas: { input: disableAdminUserRequestSchema, output: okResponseSchema },
  handler: async ({ input, deps, actor }) => {
    await serviceOf(deps).disableUser(actor, input)
    return { ok: true } as const
  },
})

export const deleteAdminUserCommand: Command<
  DeleteAdminUserRequest,
  OkResponse,
  AdminUsersCommandDeps
> = createCommand({
  method: 'deleteAdminUser',
  auth: { ability: ADMIN_USERS_ABILITIES.delete },
  schemas: { input: deleteAdminUserRequestSchema, output: okResponseSchema },
  handler: async ({ input, deps, actor }) => {
    await serviceOf(deps).deleteUser(actor, input)
    return { ok: true } as const
  },
})
