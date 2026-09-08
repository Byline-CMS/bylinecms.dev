/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SignInRateLimitStore } from '@byline/admin/auth'
import { eq, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type { ResultSetHeader } from 'mysql2'

import { adminSignInRateLimits as counters } from '../../database/schema/auth.js'
import { retryDeadlock } from './retry-deadlock.js'
import type * as schema from '../../database/schema/index.js'

export function createSignInRateLimitStore(
  db: MySql2Database<typeof schema>
): SignInRateLimitStore {
  return {
    async consume(key, limit, expiresAt) {
      // The upsert holds the row lock until our read commits, including concurrent first inserts.
      return retryDeadlock(() =>
        db.transaction(async (tx) => {
          await tx
            .insert(counters)
            .values({ key, attempts: 1, expires_at: expiresAt })
            .onDuplicateKeyUpdate({
              set: { attempts: sql`least(${counters.attempts} + 1, ${limit + 1})` },
            })
          const [row] = await tx
            .select({ attempts: counters.attempts })
            .from(counters)
            .where(eq(counters.key, key))
            .for('update')
          if (!row) throw new Error('Sign-in counter update returned no row')
          return row.attempts <= limit
        })
      )
    },
    async purgeExpired(before) {
      const [result] = await db.execute(
        sql`delete from ${counters} where ${counters.expires_at} < ${before.toISOString().slice(0, 23).replace('T', ' ')} limit 100`
      )
      return (result as ResultSetHeader).affectedRows
    },
  }
}
