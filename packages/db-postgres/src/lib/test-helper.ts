import type { CollectionDefinition } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from '../database/schema/index.js'
import { createCommandBuilders } from '../storage/storage-commands.js'
import { createQueryBuilders } from '../storage/storage-queries.js'

let pool: pg.Pool
let db: NodePgDatabase<typeof schema>
let commandBuilders: ReturnType<typeof createCommandBuilders>
let queryBuilders: ReturnType<typeof createQueryBuilders>

export function setupTestDB(collections: CollectionDefinition[] = []) {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.POSTGRES_CONNECTION_STRING,
      max: 20,
      idleTimeoutMillis: 2000,
      connectionTimeoutMillis: 1000,
    })
  }

  if (!db) {
    db = drizzle(pool, { schema })
  }

  if (!commandBuilders) {
    commandBuilders = createCommandBuilders(db)
  }

  // Recreate queryBuilders when collections are provided so that
  // DocumentQueries can resolve collection definitions by path.
  queryBuilders = createQueryBuilders(db, collections)

  return { pool, db, commandBuilders, queryBuilders }
}

export async function teardownTestDB() {
  if (pool) {
    await pool.end()
    pool = undefined as any
    db = undefined as any
    commandBuilders = undefined as any
    queryBuilders = undefined as any
  }
}
