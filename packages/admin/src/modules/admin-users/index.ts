/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-users` — admin user CRUD.
 *
 * Exports the adapter-facing `AdminUsersRepository` contract, ability
 * keys, transport-agnostic commands, the `AdminUsersService`, the seed
 * helper, and the module's error types. Commands are the recommended
 * entry point for any caller; the service is exposed for internal uses
 * (seeds, other services) that want to skip Zod/ability overhead.
 *
 * Password hashing is owned by `@byline/admin/auth`; this module takes
 * pre-hashed `password_hash` strings on the repository boundary so the
 * adapter never sees plaintext.
 */

export {
  ADMIN_USERS_ABILITIES,
  type AdminUsersAbilityKey,
  registerAdminUsersAbilities,
} from './abilities.js'
export {
  createAdminUserCommand,
  deleteAdminUserCommand,
  disableAdminUserCommand,
  enableAdminUserCommand,
  getAdminUserCommand,
  listAdminUsersCommand,
  setAdminUserPasswordCommand,
  updateAdminUserCommand,
} from './commands.js'
export { toAdminUser } from './dto.js'
export {
  AdminUsersError,
  type AdminUsersErrorCode,
  AdminUsersErrorCodes,
  ERR_ADMIN_USER_EMAIL_IN_USE,
  ERR_ADMIN_USER_NOT_FOUND,
  ERR_ADMIN_USER_SELF_DELETE,
  ERR_ADMIN_USER_SELF_DISABLE,
  ERR_ADMIN_USER_VERSION_CONFLICT,
} from './errors.js'
export {
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
export {
  type SeedSuperAdminInput,
  type SeedSuperAdminResult,
  seedSuperAdmin,
} from './seed-super-admin.js'
export { AdminUsersService } from './service.js'
export type { AdminUsersCommandDeps } from './commands.js'
export type {
  AdminUserListOrder,
  AdminUserRow,
  AdminUsersRepository,
  AdminUserWithPasswordRow,
  CountAdminUsersOptions,
  CreateAdminUserInput,
  ListAdminUsersOptions,
  UpdateAdminUserInput,
} from './repository.js'
export type {
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
