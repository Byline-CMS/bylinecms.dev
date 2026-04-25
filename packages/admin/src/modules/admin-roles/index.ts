/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-roles` — role CRUD, reorder, and role ↔ user
 * assignment.
 *
 * Exports the adapter-facing `AdminRolesRepository` contract, ability
 * keys, transport-agnostic commands, the `AdminRolesService`, and the
 * module's error types. Commands are the recommended entry point for
 * any caller; the service is exposed for internal uses (other services,
 * future seeds) that want to skip Zod/ability overhead.
 *
 * Per-role ability grants live on the sibling
 * `@byline/admin/admin-permissions` module, not here.
 */

export {
  ADMIN_ROLES_ABILITIES,
  type AdminRolesAbilityKey,
  registerAdminRolesAbilities,
} from './abilities.js'
export {
  createAdminRoleCommand,
  deleteAdminRoleCommand,
  getAdminRoleCommand,
  getRolesForUserCommand,
  listAdminRolesCommand,
  reorderAdminRolesCommand,
  setRolesForUserCommand,
  updateAdminRoleCommand,
} from './commands.js'
export { toAdminRole } from './dto.js'
export {
  AdminRolesError,
  type AdminRolesErrorCode,
  AdminRolesErrorCodes,
  ERR_ADMIN_ROLE_MACHINE_NAME_IN_USE,
  ERR_ADMIN_ROLE_NOT_FOUND,
  ERR_ADMIN_ROLE_USER_NOT_FOUND,
  ERR_ADMIN_ROLE_VERSION_CONFLICT,
} from './errors.js'
export {
  adminRoleListResponseSchema,
  adminRoleResponseSchema,
  createAdminRoleRequestSchema,
  deleteAdminRoleRequestSchema,
  getAdminRoleRequestSchema,
  getRolesForUserRequestSchema,
  listAdminRolesRequestSchema,
  reorderAdminRolesRequestSchema,
  setRolesForUserRequestSchema,
  updateAdminRoleRequestSchema,
  userRolesResponseSchema,
} from './schemas.js'
export { AdminRolesService } from './service.js'
export type { AdminRolesCommandDeps } from './commands.js'
export type {
  AdminRoleRow,
  AdminRolesRepository,
  CreateAdminRoleInput,
  UpdateAdminRoleInput,
} from './repository.js'
export type {
  AdminRoleListResponse,
  AdminRoleResponse,
  CreateAdminRoleRequest,
  DeleteAdminRoleRequest,
  GetAdminRoleRequest,
  GetRolesForUserRequest,
  ListAdminRolesRequest,
  ReorderAdminRolesRequest,
  SetRolesForUserRequest,
  UpdateAdminRoleRequest,
  UserRolesResponse,
} from './schemas.js'
