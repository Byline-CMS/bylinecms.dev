/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import { assertAdminActor } from '../../lib/assert-admin-actor.js'
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
  OkResponse,
  UserRolesResponse,
} from './schemas.js'

/**
 * Transport-agnostic commands for the admin-roles module.
 *
 * Every command follows the same four steps as `admin-users`:
 *   1. `schema.parse(input)` — Zod-validate.
 *   2. `assertAdminActor(context, ability)` — require an `AdminAuth`
 *      actor holding the specific ability.
 *   3. Call the `AdminRolesService` method with the validated input.
 *   4. Parse the response through its output schema (catches
 *      schema/DTO drift in tests).
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

export async function listAdminRolesCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<AdminRoleListResponse> {
  listAdminRolesRequestSchema.parse(input ?? {})
  assertAdminActor(context, ADMIN_ROLES_ABILITIES.read)
  const result = await serviceOf(deps).listRoles()
  return adminRoleListResponseSchema.parse(result)
}

export async function getAdminRoleCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<AdminRoleResponse> {
  const parsed = getAdminRoleRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_ROLES_ABILITIES.read)
  const result = await serviceOf(deps).getRole(parsed)
  return adminRoleResponseSchema.parse(result)
}

export async function createAdminRoleCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<AdminRoleResponse> {
  const parsed = createAdminRoleRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_ROLES_ABILITIES.create)
  const result = await serviceOf(deps).createRole(parsed)
  return adminRoleResponseSchema.parse(result)
}

export async function updateAdminRoleCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<AdminRoleResponse> {
  const parsed = updateAdminRoleRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_ROLES_ABILITIES.update)
  const result = await serviceOf(deps).updateRole(parsed)
  return adminRoleResponseSchema.parse(result)
}

export async function deleteAdminRoleCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<OkResponse> {
  const parsed = deleteAdminRoleRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_ROLES_ABILITIES.delete)
  await serviceOf(deps).deleteRole(parsed)
  return okResponseSchema.parse({ ok: true })
}

export async function reorderAdminRolesCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<OkResponse> {
  const parsed = reorderAdminRolesRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_ROLES_ABILITIES.update)
  await serviceOf(deps).reorderRoles(parsed)
  return okResponseSchema.parse({ ok: true })
}

export async function getRolesForUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<UserRolesResponse> {
  const parsed = getRolesForUserRequestSchema.parse(input)
  // Reading a user's role assignments requires read access to admin
  // users — the data is fundamentally about that user.
  assertAdminActor(context, ADMIN_USERS_ABILITIES.read)
  const result = await serviceOf(deps).getRolesForUser(parsed)
  return userRolesResponseSchema.parse(result)
}

export async function setRolesForUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminRolesCommandDeps
): Promise<UserRolesResponse> {
  const parsed = setRolesForUserRequestSchema.parse(input)
  // Editing a user's role-set is at the same trust level as updating
  // their other admin fields. Roll into `admin.users.update` rather
  // than minting a separate `admin.users.assignRoles` key — the role
  // editor's checkbox tree would otherwise need both.
  assertAdminActor(context, ADMIN_USERS_ABILITIES.update)
  const result = await serviceOf(deps).setRolesForUser(parsed)
  return userRolesResponseSchema.parse(result)
}
