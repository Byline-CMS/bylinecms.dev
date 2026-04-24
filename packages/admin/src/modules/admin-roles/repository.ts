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
 *
 * **Optimistic concurrency.** `update`, `delete`, and `reorder` take an
 * `expectedVid` and bump the stored `vid` on success. Adapters throw
 * `AdminRolesError(VERSION_CONFLICT)` when the stored vid differs from
 * the expected one — typical client response is to reload the form.
 *
 * `machine_name` is **immutable post-create**. The `UpdateAdminRoleInput`
 * type omits it deliberately so renaming the slug is a deliberate
 * separate operation if it ever ships.
 */

export interface AdminRoleRow {
  id: string
  vid: number
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
  /** Roles ordered by their `order` column then `created_at`. No paging — the list is small by design. */
  list(): Promise<AdminRoleRow[]>
  /**
   * Content update with optimistic concurrency. Throws
   * `AdminRolesError(VERSION_CONFLICT)` if the stored `vid` differs from
   * `expectedVid`. Bumps `vid` on success and returns the fresh row.
   */
  update(id: string, expectedVid: number, patch: UpdateAdminRoleInput): Promise<AdminRoleRow>
  /**
   * Delete with optimistic concurrency. Version-gated on `expectedVid` to
   * prevent races against a concurrent update.
   */
  delete(id: string, expectedVid: number): Promise<void>
  /**
   * Bulk reorder. The provided `ids` array fixes the new `order` value
   * for each role to its index in the array. Runs in a single
   * transaction. Roles not present in `ids` are left untouched.
   *
   * Vid-less by design — reorder mutates only the `order` column and
   * the UX shape is always "drag, then save the whole list", which would
   * pointlessly conflict with concurrent edits to other fields. Last
   * writer on the order column wins.
   */
  reorder(ids: string[]): Promise<void>

  /** Assign a role to a user. Idempotent via the composite primary key. */
  assignToUser(roleId: string, userId: string): Promise<void>
  unassignFromUser(roleId: string, userId: string): Promise<void>
  listRolesForUser(userId: string): Promise<AdminRoleRow[]>
  listUsersForRole(roleId: string): Promise<string[]>
}
