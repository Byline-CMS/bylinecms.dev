/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

/**
 * Ability keys for the admin-activity module (docs/06-auth-and-security/02-auditability.md — Workstream 4).
 *
 * `read` gates the system-wide activity area — the `/admin/activity` report
 * over the version-stream + audit-log union. It is deliberately a **separate**
 * ability from any collection's `collections.<path>.read`: the activity feed is
 * not reachable transitively from a content ability, so an auditor role can be
 * granted visibility into who-changed-what without being granted read (let
 * alone write) access to the documents themselves.
 *
 * Read-only by design — there is no write counterpart. The audit log is
 * append-only and is written by the lifecycle write-points, never edited.
 */
export const ADMIN_ACTIVITY_ABILITIES = {
  read: 'admin.activity.read',
} as const

export type AdminActivityAbilityKey =
  (typeof ADMIN_ACTIVITY_ABILITIES)[keyof typeof ADMIN_ACTIVITY_ABILITIES]

/**
 * Called from `registerAdminAbilities(registry)` at package level, which
 * fans out to every admin module's registrar so the webapp wiring stays a
 * single line.
 */
export function registerAdminActivityAbilities(registry: AbilityRegistry): void {
  registry.register({
    key: ADMIN_ACTIVITY_ABILITIES.read,
    label: 'Read system activity',
    description:
      'View the system-wide activity report — content saves and audit-log ' +
      'events (status / path / locale changes, deletions) across all collections.',
    group: 'admin.activity',
    source: 'admin',
  })
}
