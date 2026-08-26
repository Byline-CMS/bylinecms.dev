/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type DbErrorClassification, DbErrorCodes } from '@byline/core'

/**
 * Classify a MySQL driver error. Walks a short `cause` chain (Drizzle's
 * `DrizzleQueryError` → the underlying mysql2 error) looking for duplicate-key
 * and foreign-key errors and returns the carried constraint or index name. Mirrors
 * `packages/db-postgres/src/modules/storage/classify-error.ts`, whose
 * pg-anatomy docblock this docblock intentionally parallels.
 *
 * MySQL error anatomy (verified against a live MySQL 9.7.1 server, not
 * assumed): a duplicate-key violation raises `ERROR 1062 (23000)`, and
 * mysql2 surfaces it as `{ code: 'ER_DUP_ENTRY', errno: 1062, sqlState:
 * '23000', message: "Duplicate entry '…' for key '<table>.<index>'" }`.
 * Unlike Postgres, there is no structural `constraint` property — the index
 * name must be parsed out of the message, and MySQL 8.0+ qualifies it with
 * the table name. Matching on the numeric `errno` (not the `code` string)
 * because it is stable across mysql2 versions and locales; the message text
 * is not guaranteed to be, though the `for key '…'` shape has held since
 * MySQL 5.x and is what we parse.
 *
 * Carriage semantics (binding, from the #45 review carry-forward): strip the
 * `<table>.` qualifier and carry the **bare index name**, so both adapters'
 * `classifyError` report the same shape for the same logical failure — core
 * never learns driver anatomy. `packages/core/src/services/document-lifecycle
 * /internals.ts` only substring-matches the constraint, so the qualified
 * form would also have worked, but a contract is uniform or it is not one.
 */
export function classifyError(err: unknown): DbErrorClassification {
  type MySqlLikeError = { errno?: number; message?: string; cause?: unknown }
  let e = err as MySqlLikeError | undefined
  for (let i = 0; i < 3 && e != null && typeof e === 'object'; i++) {
    if (e.errno === 1062) {
      const match = typeof e.message === 'string' ? e.message.match(/for key '([^']+)'/) : null
      const qualifiedName = match?.[1]
      // MySQL 8.0+ qualifies the index name as `<table>.<index>` — strip the
      // table qualifier so the carried value is the bare index name only.
      const constraint = qualifiedName?.includes('.')
        ? qualifiedName.slice(qualifiedName.indexOf('.') + 1)
        : qualifiedName
      return { code: DbErrorCodes.UNIQUE_VIOLATION, constraint }
    }
    // InnoDB's table-level FK failures use 1451/1452 and carry a constraint
    // name. Legacy 1216/1217 variants omit the name, so they remain UNKNOWN.
    if (e.errno === 1451 || e.errno === 1452) {
      const match =
        typeof e.message === 'string' ? e.message.match(/CONSTRAINT [`']([^`']+)[`']/) : null
      return { code: DbErrorCodes.FOREIGN_KEY_VIOLATION, constraint: match?.[1] }
    }
    e = e.cause as MySqlLikeError | undefined
  }
  return { code: DbErrorCodes.UNKNOWN }
}
