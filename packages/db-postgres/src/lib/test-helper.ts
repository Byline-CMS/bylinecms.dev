import type { CollectionDefinition } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from '../database/schema/index.js'
import { createCommandBuilders } from '../modules/storage/storage-commands.js'
import { createQueryBuilders } from '../modules/storage/storage-queries.js'
import { assertTestDatabase } from './test-db.js'

let pool: pg.Pool
let db: NodePgDatabase<typeof schema>
let commandBuilders: ReturnType<typeof createCommandBuilders>
let queryBuilders: ReturnType<typeof createQueryBuilders>

export function setupTestDB(collections: CollectionDefinition[] = []) {
  if (!pool) {
    assertTestDatabase(process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING)
    pool = new pg.Pool({
      connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING,
      // node:test runs each test file in its own process. Even though
      // tests target a dedicated `byline_test` database, a pool-per-file
      // of 20 connections × N files can still pressure Postgres's default
      // `max_connections=100`. Tests are serial and run one query at a
      // time, so a small pool is sufficient.
      max: 4,
      idleTimeoutMillis: 2000,
      connectionTimeoutMillis: 1000,
    })
  }

  if (!db) {
    db = drizzle(pool, { schema })
  }

  if (!commandBuilders) {
    commandBuilders = createCommandBuilders(db, 'en')
  }

  // Recreate queryBuilders when collections are provided so that
  // DocumentQueries can resolve collection definitions by path.
  queryBuilders = createQueryBuilders(db, collections, 'en')

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
