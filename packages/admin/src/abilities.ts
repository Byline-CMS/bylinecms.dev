/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

import { registerAdminPermissionsAbilities } from './modules/admin-permissions/abilities.js'
import { registerAdminRolesAbilities } from './modules/admin-roles/abilities.js'
import { registerAdminUsersAbilities } from './modules/admin-users/abilities.js'

/**
 * Register every ability contributed by the admin subsystem.
 *
 * Called once at `initBylineCore()` time from the webapp config. Each
 * admin module contributes its own registrar (`registerAdminUsersAbilities`,
 * `registerAdminRolesAbilities`, …); this function fans out to them so
 * the webapp wiring stays a single line.
 *
 * Admin does not self-register from core to keep the `@byline/core`
 * package free of a dependency on `@byline/admin` — the registration
 * call is an opt-in at the composition root.
 */
export function registerAdminAbilities(registry: AbilityRegistry): void {
  registerAdminUsersAbilities(registry)
  registerAdminRolesAbilities(registry)
  registerAdminPermissionsAbilities(registry)
  // registerAccountAbilities(registry) — added when that module lands
}
