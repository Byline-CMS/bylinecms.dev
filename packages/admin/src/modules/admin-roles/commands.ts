/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type Command, createCommand } from '../../lib/create-command.js'
import { ADMIN_USERS_ABILITIES } from '../admin-users/abilities.js'
import { ADMIN_ROLES_ABILITIES } from './abilities.js'
import {
  adminRoleListResponseSchema,
  adminRoleResponseSchema,
  createAdminRoleRequestSchema,
  deleteAdminRoleRequestSchema,
  getAdminRoleRequestSchema,
  getRolesForUserRequestSchema,
  listAdminRolesRequestSchema,
  okResponseSchema,
  reorderAdminRolesRequestSchema,
  setRolesForUserRequestSchema,
  updateAdminRoleRequestSchema,
  userRolesResponseSchema,
} from './schemas.js'
import { AdminRolesService } from './service.js'
import type { AdminStore } from '../../store.js'
import type {
  AdminRoleListResponse,
  AdminRoleResponse,
  CreateAdminRoleRequest,
  DeleteAdminRoleRequest,
  GetAdminRoleRequest,
  GetRolesForUserRequest,
  ListAdminRolesRequest,
  OkResponse,
  ReorderAdminRolesRequest,
  SetRolesForUserRequest,
  UpdateAdminRoleRequest,
  UserRolesResponse,
} from './schemas.js'

/**
 * Transport-agnostic commands for the admin-roles module.
 *
 * Every command goes through `createCommand`, which folds the four
 * standard steps (validate → assert admin actor + ability → invoke
 * service → validate output) into one declaration.
 *
 * Reorder uses the `update` ability — see `abilities.ts` for the
 * rationale (same trust level as content updates; splitting it would
 * force a redundant key on every role-managing role).
 */

export interface AdminRolesCommandDeps {
  store: AdminStore
}

function serviceOf(deps: AdminRolesCommandDeps): AdminRolesService {
  return new AdminRolesService({ store: deps.store })
}

export const listAdminRolesCommand: Command<
  ListAdminRolesRequest,
  AdminRoleListResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'listAdminRoles',
  auth: { ability: ADMIN_ROLES_ABILITIES.read },
  schemas: { input: listAdminRolesRequestSchema, output: adminRoleListResponseSchema },
  handler: ({ deps }) => serviceOf(deps).listRoles(),
})

export const getAdminRoleCommand: Command<
  GetAdminRoleRequest,
  AdminRoleResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'getAdminRole',
  auth: { ability: ADMIN_ROLES_ABILITIES.read },
  schemas: { input: getAdminRoleRequestSchema, output: adminRoleResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).getRole(input),
})

export const createAdminRoleCommand: Command<
  CreateAdminRoleRequest,
  AdminRoleResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'createAdminRole',
  auth: { ability: ADMIN_ROLES_ABILITIES.create },
  schemas: { input: createAdminRoleRequestSchema, output: adminRoleResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).createRole(input),
})

export const updateAdminRoleCommand: Command<
  UpdateAdminRoleRequest,
  AdminRoleResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'updateAdminRole',
  auth: { ability: ADMIN_ROLES_ABILITIES.update },
  schemas: { input: updateAdminRoleRequestSchema, output: adminRoleResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).updateRole(input),
})

export const deleteAdminRoleCommand: Command<
  DeleteAdminRoleRequest,
  OkResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'deleteAdminRole',
  auth: { ability: ADMIN_ROLES_ABILITIES.delete },
  schemas: { input: deleteAdminRoleRequestSchema, output: okResponseSchema },
  handler: async ({ input, deps }) => {
    await serviceOf(deps).deleteRole(input)
    return { ok: true } as const
  },
})

export const reorderAdminRolesCommand: Command<
  ReorderAdminRolesRequest,
  OkResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'reorderAdminRoles',
  auth: { ability: ADMIN_ROLES_ABILITIES.update },
  schemas: { input: reorderAdminRolesRequestSchema, output: okResponseSchema },
  handler: async ({ input, deps }) => {
    await serviceOf(deps).reorderRoles(input)
    return { ok: true } as const
  },
})

export const getRolesForUserCommand: Command<
  GetRolesForUserRequest,
  UserRolesResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'getRolesForUser',
  // Reading a user's role assignments requires read access to admin
  // users — the data is fundamentally about that user.
  auth: { ability: ADMIN_USERS_ABILITIES.read },
  schemas: { input: getRolesForUserRequestSchema, output: userRolesResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).getRolesForUser(input),
})

export const setRolesForUserCommand: Command<
  SetRolesForUserRequest,
  UserRolesResponse,
  AdminRolesCommandDeps
> = createCommand({
  method: 'setRolesForUser',
  // Editing a user's role-set is at the same trust level as updating
  // their other admin fields. Roll into `admin.users.update` rather
  // than minting a separate `admin.users.assignRoles` key — the role
  // editor's checkbox tree would otherwise need both.
  auth: { ability: ADMIN_USERS_ABILITIES.update },
  schemas: { input: setRolesForUserRequestSchema, output: userRolesResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).setRolesForUser(input),
})
