/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminRoleRow } from './repository.js'
import type { AdminRoleResponse } from './schemas.js'

/**
 * Shape an `AdminRoleRow` into its public `AdminRoleResponse` form.
 *
 * Effectively an identity map today — the indirection exists so future
 * row-only fields (tenant id, soft-delete) stay opted out of the public
 * shape by default.
 */
export function toAdminRole(row: AdminRoleRow): AdminRoleResponse {
  return {
    id: row.id,
    vid: row.vid,
    name: row.name,
    machine_name: row.machine_name,
    description: row.description,
    order: row.order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
