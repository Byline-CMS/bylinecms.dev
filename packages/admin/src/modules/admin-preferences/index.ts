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
 * (e.g. `collections.docs.list`, `analytics.dashboard`) is the
 * generality lever: a new admin surface claims its own scope by
 * registering a value schema for it in `schemas.ts`, which keeps each
 * family's payload strictly validated and unregistered scopes
 * unwritable. Storage itself is untouched — scopes share one JSON
 * key-value table.
 */

export { getPreferenceCommand, setPreferenceCommand } from './commands.js'
export {
  analyticsViewPreferenceValueSchema,
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
