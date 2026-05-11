/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

import { type Command, createCommand } from '../../lib/create-command.js'
import { ADMIN_PERMISSIONS_ABILITIES } from './abilities.js'
import {
  getRoleAbilitiesRequestSchema,
  getRoleAbilitiesResponseSchema,
  listRegisteredAbilitiesRequestSchema,
  listRegisteredAbilitiesResponseSchema,
  setRoleAbilitiesRequestSchema,
  setRoleAbilitiesResponseSchema,
  whoHasAbilityRequestSchema,
  whoHasAbilityResponseSchema,
} from './schemas.js'
import { AdminPermissionsService } from './service.js'
import type { AdminStore } from '../../store.js'
import type {
  GetRoleAbilitiesRequest,
  GetRoleAbilitiesResponse,
  ListRegisteredAbilitiesRequest,
  ListRegisteredAbilitiesResponse,
  SetRoleAbilitiesRequest,
  SetRoleAbilitiesResponse,
  WhoHasAbilityRequest,
  WhoHasAbilityResponse,
} from './schemas.js'

/**
 * Transport-agnostic commands for the admin-permissions inspector.
 *
 * Built through `createCommand`, which folds the four standard steps
 * (validate → assert admin actor + ability → invoke service → validate
 * output) into one declaration. All inspector reads gate on
 * `admin.permissions.read`; the write gates on `admin.permissions.update`.
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

export const listRegisteredAbilitiesCommand: Command<
  ListRegisteredAbilitiesRequest,
  ListRegisteredAbilitiesResponse,
  AdminPermissionsCommandDeps
> = createCommand({
  method: 'listRegisteredAbilities',
  auth: { ability: ADMIN_PERMISSIONS_ABILITIES.read },
  schemas: {
    input: listRegisteredAbilitiesRequestSchema,
    output: listRegisteredAbilitiesResponseSchema,
  },
  handler: ({ deps }) => serviceOf(deps).listRegisteredAbilities(),
})

export const whoHasAbilityCommand: Command<
  WhoHasAbilityRequest,
  WhoHasAbilityResponse,
  AdminPermissionsCommandDeps
> = createCommand({
  method: 'whoHasAbility',
  auth: { ability: ADMIN_PERMISSIONS_ABILITIES.read },
  schemas: { input: whoHasAbilityRequestSchema, output: whoHasAbilityResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).whoHasAbility(input),
})

export const getRoleAbilitiesCommand: Command<
  GetRoleAbilitiesRequest,
  GetRoleAbilitiesResponse,
  AdminPermissionsCommandDeps
> = createCommand({
  method: 'getRoleAbilities',
  auth: { ability: ADMIN_PERMISSIONS_ABILITIES.read },
  schemas: { input: getRoleAbilitiesRequestSchema, output: getRoleAbilitiesResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).getRoleAbilities(input),
})

export const setRoleAbilitiesCommand: Command<
  SetRoleAbilitiesRequest,
  SetRoleAbilitiesResponse,
  AdminPermissionsCommandDeps
> = createCommand({
  method: 'setRoleAbilities',
  auth: { ability: ADMIN_PERMISSIONS_ABILITIES.update },
  schemas: { input: setRoleAbilitiesRequestSchema, output: setRoleAbilitiesResponseSchema },
  handler: ({ input, deps }) => serviceOf(deps).setRoleAbilities(input),
})
