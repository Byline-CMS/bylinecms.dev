/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry, RequestContext } from '@byline/auth'

import { assertAdminActor } from '../../lib/assert-admin-actor.js'
import { ADMIN_PERMISSIONS_ABILITIES } from './abilities.js'
import {
  listRegisteredAbilitiesRequestSchema,
  listRegisteredAbilitiesResponseSchema,
  whoHasAbilityRequestSchema,
  whoHasAbilityResponseSchema,
} from './schemas.js'
import { AdminPermissionsService } from './service.js'
import type { AdminStore } from '../../store.js'
import type { ListRegisteredAbilitiesResponse, WhoHasAbilityResponse } from './schemas.js'

/**
 * Transport-agnostic commands for the admin-permissions inspector.
 *
 * Same four-step shape as the other modules — Zod-validate, assert the
 * admin actor + ability, call the service, validate the output. The
 * inspector commands all gate on `admin.permissions.read`.
 *
 * Deps include the `AbilityRegistry` alongside the `AdminStore` because
 * the inspector reads the registered abilities directly from the
 * registry (no DB). The webapp threads `bylineCore.abilities` in.
 */

export interface AdminPermissionsCommandDeps {
  store: AdminStore
  abilities: AbilityRegistry
}

function serviceOf(deps: AdminPermissionsCommandDeps): AdminPermissionsService {
  return new AdminPermissionsService({ store: deps.store, abilities: deps.abilities })
}

export async function listRegisteredAbilitiesCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminPermissionsCommandDeps
): Promise<ListRegisteredAbilitiesResponse> {
  listRegisteredAbilitiesRequestSchema.parse(input ?? {})
  assertAdminActor(context, ADMIN_PERMISSIONS_ABILITIES.read)
  const result = serviceOf(deps).listRegisteredAbilities()
  return listRegisteredAbilitiesResponseSchema.parse(result)
}

export async function whoHasAbilityCommand(
  context: RequestContext | undefined,
  input: unknown,
  deps: AdminPermissionsCommandDeps
): Promise<WhoHasAbilityResponse> {
  const parsed = whoHasAbilityRequestSchema.parse(input)
  assertAdminActor(context, ADMIN_PERMISSIONS_ABILITIES.read)
  const result = await serviceOf(deps).whoHasAbility(parsed)
  return whoHasAbilityResponseSchema.parse(result)
}
