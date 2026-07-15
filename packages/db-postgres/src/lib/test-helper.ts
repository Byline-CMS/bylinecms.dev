import type { CollectionDefinition } from '@byline/core'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from '../database/schema/index.js'
import { createCommandBuilders } from '../modules/storage/storage-commands.js'
import { createQueryBuilders } from '../modules/storage/storage-queries.js'
import { DBManagerImpl, TXManagerImpl } from './db-manager.js'
import { assertTestDatabase } from './test-db.js'

let pool: pg.Pool
let db: NodePgDatabase<typeof schema>
let dbManager: DBManagerImpl
let txManager: TXManagerImpl
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

  if (!dbManager) {
    dbManager = new DBManagerImpl({ dbPool: db })
    txManager = new TXManagerImpl({ db: dbManager })
  }

  if (!commandBuilders) {
    commandBuilders = createCommandBuilders(dbManager, 'en')
  }

  // Recreate queryBuilders when collections are provided so that
  // DocumentQueries can resolve collection definitions by path.
  queryBuilders = createQueryBuilders(db, collections, 'en', dbManager)

  return { pool, db, dbManager, txManager, commandBuilders, queryBuilders }
}

export async function teardownTestDB() {
  if (pool) {
    await pool.end()
    pool = undefined as any
    db = undefined as any
    dbManager = undefined as any
    txManager = undefined as any
    commandBuilders = undefined as any
    queryBuilders = undefined as any
  }
}
