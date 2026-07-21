/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service business logic for per-user admin preferences. Every
 * method takes `actorId` sourced server-side from the authenticated
 * `RequestContext` — callers cannot supply a target user id.
 */

import type { AdminPreferencesRepository } from './repository.js'
import type { PreferenceResponse } from './schemas.js'

export class AdminPreferencesService {
  readonly #repo: AdminPreferencesRepository

  constructor(deps: { repo: AdminPreferencesRepository }) {
    this.#repo = deps.repo
  }

  async getPreference(actorId: string, scope: string): Promise<PreferenceResponse> {
    const row = await this.#repo.get(actorId, scope)
    return { scope, value: row?.value ?? null }
  }

  async setPreference(
    actorId: string,
    scope: string,
    patch: Record<string, unknown>
  ): Promise<PreferenceResponse> {
    const row = await this.#repo.upsert(actorId, scope, patch)
    return { scope, value: row.value }
  }
}
