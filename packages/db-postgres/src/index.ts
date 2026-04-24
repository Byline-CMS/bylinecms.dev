/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './database/schema/index.js'
import { createCommandBuilders } from './modules/storage/storage-commands.js'
import { createQueryBuilders } from './modules/storage/storage-queries.js'

/**
 * Public return type of `pgAdapter`. Extends `IDbAdapter` with concrete
 * Drizzle + pg handles so integrations that need the raw database (the
 * session provider, housekeeping scripts, migration tooling) don't have
 * to construct a second connection pool.
 *
 * Consumers that only need the adapter contract can still annotate as
 * `IDbAdapter` and ignore the extra properties.
 */
export interface PgAdapter extends IDbAdapter {
  /** The underlying Drizzle instance typed against the full schema. */
  drizzle: NodePgDatabase<typeof schema>
  /** The pg connection pool — exposed for housekeeping and teardown. */
  pool: pg.Pool
}

export const pgAdapter = ({
  connectionString,
  collections,
}: {
  connectionString: string
  collections: CollectionDefinition[]
}): PgAdapter => {
  const pool = new pg.Pool({
    connectionString: connectionString,
    max: 20,
    idleTimeoutMillis: 2000,
    connectionTimeoutMillis: 1000,
  })

  const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema })

  const commandBuilders = createCommandBuilders(db)
  const queryBuilders = createQueryBuilders(db, collections)

  return {
    commands: commandBuilders,
    queries: queryBuilders,
    drizzle: db,
    pool,
  }
}
