/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Audit actor-label resolution (docs/06-auth-and-security/02-auditability.md — Workstream 1).
 *
 * Shaped documents carry only the raw `createdBy` uuid; turning ids into
 * display labels is an **admin-realm** concern, so it happens here — in
 * the admin server-fn layer, which already holds the admin actor and the
 * `AdminStore` — never as a JOIN inside the document storage adapter
 * (which must stay ignorant of admin-realm tables for the future
 * `UserAuth` writer realm).
 *
 * Responses attach the result as an `actors` map alongside the page of
 * documents; the UI joins by id. Ids with no matching admin-user row
 * (deleted users) are absent from the map — consumers render a tombstone
 * label.
 */

import type { AdminUserRow } from '@byline/admin/admin-users'

import { bylineCore } from '../../integrations/byline-core.js'

export type ActorLabelMap = Record<string, { label: string }>

/** Display label: full name → username → email. */
function labelFor(row: AdminUserRow): string {
  const name = [row.given_name, row.family_name].filter(Boolean).join(' ')
  return name || row.username || row.email
}

/**
 * Batch-resolve admin-user ids to display labels. Accepts the raw
 * `createdBy` values straight off a page of shaped documents — nullish
 * and duplicate entries are tolerated and deduplicated. Returns `{}`
 * when there is nothing to resolve or no admin store is configured.
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
