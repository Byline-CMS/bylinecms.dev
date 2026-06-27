/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext, type RequestContext } from '@byline/auth'
import {
  type CollectionDefinition,
  defineServerConfig,
  type IDbAdapter,
  type RichTextPopulateFn,
} from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'

import { type BylineClient, createBylineClient } from '../../src/index.js'

/**
 * Wire a BylineClient + adapter against the live `byline_test` Postgres,
 * register the supplied collections in `byline_collections`, and register a
 * minimal `ServerConfig` so `getCollectionDefinition()` resolves at runtime.
 *
 * Returns the `db` adapter, `client`, and the collection-id row map keyed
 * by `definition.path`. Multi-collection callers (relations, populate)
 * read the ids from the map; single-collection callers use the
 * convenience wrapper below.
 */
export interface MultiCollectionTestContext {
  client: BylineClient
  db: IDbAdapter
  collectionIds: Record<string, string>
}

export async function setupMultiCollectionTestClient(
  definitions: CollectionDefinition[],
  options: {
    requestContext?: RequestContext | (() => RequestContext)
    /**
     * Optional richtext populate adapter wired into the read pipeline.
     * Threaded through to `createBylineClient` so `CollectionHandle` reads
     * walk rich-text leaves whose `populateRelationsOnRead` is effectively
     * true. Used by the richtext-populate integration test.
     */
    richTextPopulate?: RichTextPopulateFn
  } = {}
): Promise<MultiCollectionTestContext> {
  const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      'BYLINE_DB_POSTGRES_CONNECTION_STRING is not set. Copy .env.test.example to .env.test.'
    )
  }

  const db = pgAdapter({ connectionString, collections: definitions, defaultContentLocale: 'en' })

  defineServerConfig({
    db,
    serverURL: 'http://localhost:3000',
    i18n: {
      interface: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: ['en'] },
    },
    collections: definitions,
  })

  const requestContext =
    options.requestContext ?? createSuperAdminContext({ id: 'test-super-admin' })

  const client = createBylineClient({
    db,
    collections: definitions,
    requestContext,
    richTextPopulate: options.richTextPopulate,
  })

  const collectionIds: Record<string, string> = {}
  for (const def of definitions) {
    const [row] = await db.commands.collections.create(def.path, def)
    if (!row) throw new Error(`Failed to create test collection '${def.path}'`)
    collectionIds[def.path] = row.id as string
  }

  return { client, db, collectionIds }
}

// Env is loaded by `tests/_per-file-setup.ts` (.env.test) before any test
// file's imports resolve. No dotenv side-effect import here.

export interface TestContext {
  client: BylineClient
  db: IDbAdapter
  collectionId: string
  definition: CollectionDefinition
}

/**
 * Single-collection convenience wrapper around
 * `setupMultiCollectionTestClient`. Preserves the legacy `TestContext`
 * shape (single `collectionId` + `definition`) used by tests that don't
 * need a multi-collection setup.
 */
export async function setupTestClient(definition: CollectionDefinition): Promise<TestContext> {
  const { client, db, collectionIds } = await setupMultiCollectionTestClient([definition])
  return {
    client,
    db,
    collectionId: collectionIds[definition.path] as string,
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
