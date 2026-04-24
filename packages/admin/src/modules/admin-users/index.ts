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
 * Exports the adapter-facing `AdminUsersRepository` contract and the
 * transport-agnostic services built on top of it (seed, and — later —
 * Zod-validated commands for create/update/enable-disable/delete).
 * Password hashing is owned by `@byline/admin/auth`; this module takes
 * pre-hashed `password_hash` strings so the adapter never sees plaintext.
 */

export {
  type SeedSuperAdminInput,
  type SeedSuperAdminResult,
  seedSuperAdmin,
} from './seed-super-admin.js'
export type {
  AdminUserRow,
  AdminUsersRepository,
  AdminUserWithPasswordRow,
  CreateAdminUserInput,
  UpdateAdminUserInput,
} from './repository.js'
