/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import { assertAdminActor } from '../../lib/assert-admin-actor.js'
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
import type { AdminUserListResponse, AdminUserResponse, OkResponse } from './schemas.js'

/**
 * Transport-agnostic commands for the admin-users module.
 *
 * Each command is a plain exported function — not a class method — to
 * match Byline's existing `document-lifecycle` shape. Every command
 * follows the same four steps in the same order:
 *
 *   1. `schema.parse(input)` — Zod-validate and normalise the raw input.
 *      Throws `ZodError` on invalid shape; transport adapters translate
 *      that into a 400-ish response.
 *   2. `assertAdminActor(context, ability)` — require an `AdminAuth`
 *      actor holding the specific ability. Throws `ERR_UNAUTHENTICATED`
 *      or `ERR_FORBIDDEN`.
 *   3. Call the `AdminUsersService` method with the validated input
 *      (plus the actor where an invariant needs it).
 *   4. Parse the response through its output schema. In production the
 *      check is redundant with the DTO's type; in tests it catches
 *      drift between schema and DTO early.
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

export async function listAdminUsersCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<AdminUserListResponse> {
  const parsed = listAdminUsersRequestSchema.parse(input ?? {})
  assertAdminActor(context, ADMIN_USERS_ABILITIES.read)
  const result = await serviceOf(deps).listUsers(parsed)
  return adminUserListResponseSchema.parse(result)
}

export async function getAdminUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<AdminUserResponse> {
  const parsed = getAdminUserRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_USERS_ABILITIES.read)
  const result = await serviceOf(deps).getUser(parsed)
  return adminUserResponseSchema.parse(result)
}

export async function createAdminUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<AdminUserResponse> {
  const parsed = createAdminUserRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_USERS_ABILITIES.create)
  const result = await serviceOf(deps).createUser(parsed)
  return adminUserResponseSchema.parse(result)
}

export async function updateAdminUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<AdminUserResponse> {
  const parsed = updateAdminUserRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_USERS_ABILITIES.update)
  const result = await serviceOf(deps).updateUser(parsed)
  return adminUserResponseSchema.parse(result)
}

export async function setAdminUserPasswordCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<AdminUserResponse> {
  const parsed = setAdminUserPasswordRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_USERS_ABILITIES.changePassword)
  const result = await serviceOf(deps).setPassword(parsed)
  return adminUserResponseSchema.parse(result)
}

export async function enableAdminUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<OkResponse> {
  const parsed = enableAdminUserRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_USERS_ABILITIES.update)
  await serviceOf(deps).enableUser(parsed)
  return okResponseSchema.parse({ ok: true })
}

export async function disableAdminUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<OkResponse> {
  const parsed = disableAdminUserRequestSchema.parse(input)
  const actor = assertAdminActor(context, ADMIN_USERS_ABILITIES.update)
  await serviceOf(deps).disableUser(actor, parsed)
  return okResponseSchema.parse({ ok: true })
}

export async function deleteAdminUserCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminUsersCommandDeps
): Promise<OkResponse> {
  const parsed = deleteAdminUserRequestSchema.parse(input)
  const actor = assertAdminActor(context, ADMIN_USERS_ABILITIES.delete)
  await serviceOf(deps).deleteUser(actor, parsed)
  return okResponseSchema.parse({ ok: true })
}
