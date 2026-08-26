/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminUserRow } from '@byline/admin/admin-users'

import { bylineCore } from '../integrations/byline-core.js'

export type ActorLabelMap = Record<string, { label: string }>

/** Display label: full name → username → email. */
function labelFor(row: AdminUserRow): string {
  const name = [row.given_name, row.family_name].filter(Boolean).join(' ')
  return name || row.username || row.email
}

/**
 * Batch-resolve admin-user ids to display labels. The admin server-fn layer
 * owns this presentation concern so both collection and singleton history
 * can share it without teaching document storage about admin-realm tables.
 */
export async function resolveActorLabels(
  ids: Iterable<string | null | undefined>
): Promise<ActorLabelMap> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ]
  if (unique.length === 0) return {}

  const store = bylineCore().adminStore
  if (store == null) return {}

  const rows = await store.adminUsers.getByIds(unique)
  const map: ActorLabelMap = {}
  for (const row of rows) {
    map[row.id] = { label: labelFor(row) }
  }
  return map
}
