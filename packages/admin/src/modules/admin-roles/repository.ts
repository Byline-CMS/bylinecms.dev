/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `AdminRolesRepository` — role CRUD plus role ↔ user assignments.
 *
 * Deliberately does *not* cover per-role ability grants — those live on
 * `AdminPermissionsRepository` (`modules/admin-permissions/repository.ts`),
 * which owns the `byline_admin_permissions` table. The split follows the
 * admin UI: role identity and membership live together; ability grants
 * are a separate editor surface driven by the ability registry.
 */

export interface AdminRoleRow {
  id: string
  name: string
  machine_name: string
  description: string | null
  order: number
  created_at: Date
  updated_at: Date
}

export interface CreateAdminRoleInput {
  name: string
  machine_name: string
  description?: string | null
  order?: number
}

export interface UpdateAdminRoleInput {
  name?: string
  description?: string | null
  order?: number
}

export interface AdminRolesRepository {
  create(input: CreateAdminRoleInput): Promise<AdminRoleRow>
  getById(id: string): Promise<AdminRoleRow | null>
  getByMachineName(machineName: string): Promise<AdminRoleRow | null>
  list(): Promise<AdminRoleRow[]>
  update(id: string, patch: UpdateAdminRoleInput): Promise<AdminRoleRow>
  delete(id: string): Promise<void>

  /** Assign a role to a user. Idempotent via the composite primary key. */
  assignToUser(roleId: string, userId: string): Promise<void>
  unassignFromUser(roleId: string, userId: string): Promise<void>
  listRolesForUser(userId: string): Promise<AdminRoleRow[]>
  listUsersForRole(roleId: string): Promise<string[]>
}
