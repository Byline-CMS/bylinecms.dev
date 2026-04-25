/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-permissions` — ability grants against roles plus
 * the read-only inspector view.
 *
 * Backs the `byline_admin_permissions` table. Ability keys are
 * registered at `initBylineCore()` time through the `AbilityRegistry`
 * from `@byline/auth`; this module owns the per-role grant data and the
 * inspector that surfaces it.
 *
 * The editor surface (`getRoleAbilities` / `setRoleAbilities`) is
 * deliberately out of scope on this first ship — it lands with Phase B
 * and mounts on the admin-roles role detail page.
 */

export {
  ADMIN_PERMISSIONS_ABILITIES,
  type AdminPermissionsAbilityKey,
  registerAdminPermissionsAbilities,
} from './abilities.js'
export {
  listRegisteredAbilitiesCommand,
  whoHasAbilityCommand,
} from './commands.js'
export { toAbilityDescriptor } from './dto.js'
export {
  AdminPermissionsError,
  type AdminPermissionsErrorCode,
  AdminPermissionsErrorCodes,
  ERR_ADMIN_PERMISSIONS_ABILITY_UNREGISTERED,
  ERR_ADMIN_PERMISSIONS_ROLE_NOT_FOUND,
} from './errors.js'
export {
  abilityDescriptorResponseSchema,
  abilityGroupResponseSchema,
  abilityHolderRoleSchema,
  abilityHolderUserSchema,
  listRegisteredAbilitiesRequestSchema,
  listRegisteredAbilitiesResponseSchema,
  whoHasAbilityRequestSchema,
  whoHasAbilityResponseSchema,
} from './schemas.js'
export { AdminPermissionsService } from './service.js'
export type { AdminPermissionsCommandDeps } from './commands.js'
export type { AdminPermissionsRepository } from './repository.js'
export type {
  AbilityDescriptorResponse,
  AbilityGroupResponse,
  AbilityHolderRole,
  AbilityHolderUser,
  ListRegisteredAbilitiesRequest,
  ListRegisteredAbilitiesResponse,
  WhoHasAbilityRequest,
  WhoHasAbilityResponse,
} from './schemas.js'
