/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import 'dotenv/config'

import { type BylineClient, createBylineClient } from '../../src/index.js'

export interface TestContext {
  client: BylineClient
  db: IDbAdapter
  collectionId: string
  definition: CollectionDefinition
}

/**
 * Create a fully wired BylineClient backed by a real Postgres instance.
 *
 * Also registers the test collection in the database and returns the
 * collection row ID so tests can seed documents directly via the adapter.
 */
export async function setupTestClient(definition: CollectionDefinition): Promise<TestContext> {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      'POSTGRES_CONNECTION_STRING is not set. Copy .env.example to .env and configure it.'
    )
  }

  const collections = [definition]

  const db = pgAdapter({ connectionString, collections })

  const client = createBylineClient({
    db,
    collections,
    requestContext: createSuperAdminContext({ id: 'test-super-admin' }),
  })

  // Register the collection in the database.
  const result = await db.commands.collections.create(definition.path, definition)
  const row = result[0]
  if (!row) {
    throw new Error(`Failed to create test collection '${definition.path}'`)
  }

  return {
    client,
    db,
    collectionId: row.id as string,
    definition,
  }
}

/**
 * Clean up: delete the test collection (cascades to documents and fields).
 */
export async function teardownTestClient(ctx: TestContext): Promise<void> {
  try {
    await ctx.db.commands.collections.delete(ctx.collectionId)
  } catch (err) {
    console.error('Failed to clean up test collection:', err)
  }
}
