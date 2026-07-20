/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Transport-agnostic commands for per-user admin preferences.
 *
 * Same self-service posture as admin-account: `auth` is
 * `{ authenticated: true }` (no ability key), and the security property
 * "you may only touch your own preferences" is structural — the target
 * id comes from `actor.id`, never from the request payload.
 */

import { type Command, createCommand } from '../../lib/create-command.js'
import {
  getPreferenceRequestSchema,
  preferenceResponseSchema,
  setPreferenceRequestSchema,
} from './schemas.js'
import { AdminPreferencesService } from './service.js'
import type { AdminStore } from '../../store.js'
import type { GetPreferenceRequest, PreferenceResponse, SetPreferenceRequest } from './schemas.js'

export interface AdminPreferencesCommandDeps {
  store: AdminStore
}

function serviceOf(deps: AdminPreferencesCommandDeps): AdminPreferencesService {
  return new AdminPreferencesService({ repo: deps.store.adminPreferences })
}

export const getPreferenceCommand: Command<
  GetPreferenceRequest,
  PreferenceResponse,
  AdminPreferencesCommandDeps
> = createCommand({
  method: 'getPreference',
  auth: { authenticated: true },
  schemas: { input: getPreferenceRequestSchema, output: preferenceResponseSchema },
  handler: ({ input, deps, actor }) => serviceOf(deps).getPreference(actor.id, input.scope),
})

export const setPreferenceCommand: Command<
  SetPreferenceRequest,
  PreferenceResponse,
  AdminPreferencesCommandDeps
> = createCommand({
  method: 'setPreference',
  auth: { authenticated: true },
  schemas: { input: setPreferenceRequestSchema, output: preferenceResponseSchema },
  handler: ({ input, deps, actor }) =>
    serviceOf(deps).setPreference(actor.id, input.scope, input.value),
})
