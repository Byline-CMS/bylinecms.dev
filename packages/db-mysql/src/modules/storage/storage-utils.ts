/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DATABASE, getLogger } from '@byline/core'

// ------------------------------------------------------------------------------
// Misc
//
// `resolveStoreTypes` lives in `@byline/core` (`packages/core/src/storage/
// storage-utils.ts`) — it is dialect-independent. `getFirstOrThrow` stays
// here: it's a result helper tied to this adapter. Mirrors
// `packages/db-postgres/src/modules/storage/storage-utils.ts`.
// ------------------------------------------------------------------------------

export const getFirstOrThrow =
  <T>(message: string) =>
  (values: T[]): T => {
    const value = values[0]
    if (value == null) {
      throw ERR_DATABASE({ message }).log(getLogger())
    }
    return value
  }

/**
 * Coerce a raw driver `DATETIME`/`TIMESTAMP` value from a `db.execute(sql\`...\`)`
 * call to a real `Date`. `drizzle-orm`'s mysql2 driver installs its own
 * `typeCast` on every raw-execute call that has no schema-typed `fields`
 * mapper — which every hand-written SQL read in this adapter is — that
 * unconditionally returns those column types as **strings**
 * (`'YYYY-MM-DD HH:MM:SS.ffffff'`, space-separated, no timezone marker),
 * regardless of the pool's own `timezone` option. Confirmed live across
 * three independent call sites in this adapter (Task 11's audit-log UNION,
 * `normalizeRow`'s `value_timestamp_tz`, and `findDocuments`' main query —
 * see the Task 11 report). Every `DATETIME`/`TIMESTAMP` column in this
 * schema is UTC by convention, so appending `Z` after normalising the
 * separator is the correct interpretation, not an assumed one. Tolerant of
 * `null`/`undefined` and of the value already being a `Date` (defensive —
 * not expected on this path, but cheap to allow and keeps callers simple).
 */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  return new Date(`${value.replace(' ', 'T')}Z`)
}
