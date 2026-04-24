import type { CollectionDefinition } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from '../database/schema/index.js'
import { createCommandBuilders } from '../modules/storage/storage-commands.js'
import { createQueryBuilders } from '../modules/storage/storage-queries.js'

let pool: pg.Pool
let db: NodePgDatabase<typeof schema>
let commandBuilders: ReturnType<typeof createCommandBuilders>
let queryBuilders: ReturnType<typeof createQueryBuilders>

export function setupTestDB(collections: CollectionDefinition[] = []) {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.POSTGRES_CONNECTION_STRING,
      // Integration tests share the dev database with the running webapp,
      // and node:test may run multiple test files in separate processes.
      // A pool-per-file of 20 connections × N files + the webapp's own
      // pool of 20 blows past Postgres's default `max_connections=100`
      // and throws `FATAL: sorry, too many clients already`. The tests
      // are serial and run one query at a time, so a small pool is
      // sufficient — keep total test connections low regardless of
      // process / file parallelism.
      max: 4,
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
