/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type DbErrorClassification, DbErrorCodes } from '@byline/core'

/**
 * Classify a Postgres driver error. Walks a short `cause` chain
 * (DrizzleQueryError → underlying pg error) looking for SQLSTATE `23505`
 * (unique violation) and returns the carried constraint name. This is the
 * driver-anatomy logic formerly inlined in core's `rethrowPathConflict`;
 * core now maps the returned classification to `ERR_PATH_CONFLICT`.
 */
export function classifyError(err: unknown): DbErrorClassification {
  type PgLikeError = { code?: string; constraint?: string; cause?: unknown }
  let e = err as PgLikeError | undefined
  for (let i = 0; i < 3 && e != null && typeof e === 'object'; i++) {
    if (e.code === '23505') {
      return { code: DbErrorCodes.UNIQUE_VIOLATION, constraint: e.constraint }
    }
    e = e.cause as PgLikeError | undefined
  }
  return { code: DbErrorCodes.UNKNOWN }
}
