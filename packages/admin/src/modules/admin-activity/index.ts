/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-activity` — the system-wide activity area
 * (docs/AUDIT.md — Workstream 4).
 *
 * Unlike the other admin modules this one owns no table and no AdminStore
 * repository: the activity feed is a read over the document db adapter's
 * version stream + audit log (`IAuditQueries.findAuditLog`), assembled at the
 * host transport layer. This module contributes only the `admin.activity.read`
 * ability — registered at `initBylineCore()` time through the `AbilityRegistry`
 * — so the feed is grantable independently of any content ability.
 */

export {
  ADMIN_ACTIVITY_ABILITIES,
  type AdminActivityAbilityKey,
  registerAdminActivityAbilities,
} from './abilities.js'
