/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { IDbAdapter } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './database/schema/index.js'
import { createCommandBuilders } from './storage/storage-commands.js'
import { createQueryBuilders } from './storage/storage-queries.js'

export const pgAdapter = ({ connectionString }: { connectionString: string }): IDbAdapter => {
  const pool = new pg.Pool({
    connectionString: connectionString,
    max: 20,
    idleTimeoutMillis: 2000,
    connectionTimeoutMillis: 1000,
  })

  const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema })

  const commandBuilders = createCommandBuilders(db)
  const queryBuilders = createQueryBuilders(db)

  return { commands: commandBuilders, queries: queryBuilders }
}
