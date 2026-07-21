/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-preferences` — scoped per-user key-value
 * preferences for the currently signed-in admin user.
 *
 * Self-service like `@byline/admin/admin-account`: the actor IS the
 * target, and there is no ability gate — authn-only. The `scope` string
 * (e.g. `collections.docs.list`) is the generality lever: new admin
 * surfaces claim their own scopes with no schema change.
 */

export { getPreferenceCommand, setPreferenceCommand } from './commands.js'
export {
  getPreferenceRequestSchema,
  listViewPreferenceValueSchema,
  preferenceResponseSchema,
  preferenceScopeSchema,
  setPreferenceRequestSchema,
} from './schemas.js'
export { AdminPreferencesService } from './service.js'
export type { AdminPreferencesCommandDeps } from './commands.js'
export type {
  AdminPreferencesRepository,
  AdminUserPreferenceRow,
} from './repository.js'
export type {
  GetPreferenceRequest,
  PreferenceResponse,
  SetPreferenceRequest,
} from './schemas.js'
