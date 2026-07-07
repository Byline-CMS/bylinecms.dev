/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-activity server fns (docs/06-auth-and-security/02-auditability.md — Workstream 4) — the
 * system-wide activity report. Reads the adapter's audit queries directly
 * (cross-collection, includes admin-realm rows) behind the
 * `admin.activity.read` gate, rather than routing through a per-document
 * read like the collections audit fn.
 */

export {
  type ActivityCollectionInfo,
  type ActivityCollectionMap,
  getSystemActivityLog,
  type SystemActivityResponse,
  type SystemActivitySearchParams,
} from './get.js'
