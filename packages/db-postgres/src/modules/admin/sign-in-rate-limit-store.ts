/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SignInRateLimitStore } from '@byline/admin/auth'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { adminSignInRateLimits as counters } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

export function createSignInRateLimitStore(
  db: NodePgDatabase<typeof schema>
): SignInRateLimitStore {
  return {
    async consume(key, limit, expiresAt) {
      const [row] = await db
        .insert(counters)
        .values({ key, attempts: 1, expires_at: expiresAt })
        .onConflictDoUpdate({
          target: counters.key,
          set: {
            attempts: sql`least(${counters.attempts} + 1, ${limit + 1})`,
          },
        })
        .returning({ attempts: counters.attempts })
      if (!row) throw new Error('Sign-in counter update returned no row')
      return row.attempts <= limit
    },
    async purgeExpired(before) {
      const result = await db.execute(sql`delete from ${counters} where ${counters.key} in (
        select ${counters.key} from ${counters} where ${counters.expires_at} < ${before.toISOString()} limit 100
      )`)
      return result.rowCount ?? 0
    },
  }
}
