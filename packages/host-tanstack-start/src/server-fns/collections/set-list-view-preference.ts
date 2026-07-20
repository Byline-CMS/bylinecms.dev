/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Persist a per-user list-view preference for one collection.
 *
 * Fire-and-forget from the list UI: changing page size or clicking a
 * column sort quietly upserts the sticky keys for
 * `collections.<path>.list`. The client sends only the keys the
 * interaction changed; the repository merges per key, so a page-size
 * change never wipes a stored sort.
 *
 * Self-service: the target user is always the authenticated actor.
 * `setPreferenceCommand` rejects unauthenticated contexts.
 */

import { createServerFn } from '@tanstack/react-start'

import { setPreferenceCommand } from '@byline/admin/admin-preferences'
import { getAdminRequestContext } from '@byline/client/server'

import { bylineCore } from '../../integrations/byline-core.js'

export interface SetListViewPreferenceInput {
  collection: string
  value: {
    page_size?: number
    order?: string
    desc?: boolean
  }
}

export const setListViewPreference = createServerFn({ method: 'POST' })
  .validator((input: SetListViewPreferenceInput) => input)
  .handler(async ({ data }) => {
    const adminStore = bylineCore().adminStore
    if (adminStore == null) {
      // Headless hosts without an admin store have no preference storage —
      // the save is a silent no-op, mirroring set-locale's posture.
      return { ok: true as const }
    }
    const context = await getAdminRequestContext()
    await setPreferenceCommand(
      context,
      { scope: `collections.${data.collection}.list`, value: data.value },
      { store: adminStore }
    )
    return { ok: true as const }
  })
