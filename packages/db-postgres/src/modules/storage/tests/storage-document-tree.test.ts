/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Postgres-specific residual of the document-tree command coverage.
 *
 * The behavioural half of the original file — placement, reordering,
 * re-parenting, cycle/cross-collection guards, ancestor/children/subtree
 * reads, row-filter scoping — ported verbatim to `@byline/db-conformance`'s
 * `document-tree` suite (`packages/db-conformance/src/suites/document-tree.ts`),
 * now run via `packages/db-postgres/tests/conformance.integration.test.ts`.
 *
 * This one test stays behind: it forces a concurrency race by taking raw
 * Postgres row locks directly (`FOR UPDATE` on `byline_document_versions` via
 * the ambient transaction executor, `FOR UPDATE NOWAIT` on `byline_collections`
 * via the pool) to prove `softDeleteDocument` and `placeTreeNode` serialize on
 * the same collection-row mutex. That's white-box coverage of Postgres's own
 * lock ordering — there is no `IDbAdapter`-level equivalent, so it can't be
 * expressed through `hooks`.
 */

import { type CollectionDefinition, ErrorCodes } from '@byline/core'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import type { DBManagerImpl, TXManagerImpl } from '../../../lib/db-manager.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let dbManager: DBManagerImpl
let txManager: TXManagerImpl
let pool: Pool

const timestamp = Date.now()

const TreeCollectionConfig: CollectionDefinition = {
  path: `tree-locking-${timestamp}`,
  labels: { singular: 'TreeLockingTest', plural: 'TreeLockingTests' },
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text' }],
}

let treeCollection: { id: string } = {} as any

async function createDoc(collectionId: string, config: CollectionDefinition, title: string) {
  const created = await commandBuilders.documents.createDocumentVersion({
    collectionId,
    collectionVersion: 1,
    collectionConfig: config,
    action: 'create',
    documentData: { title },
    path: `${title.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`,
    locale: 'all',
    status: 'published',
  })
  return created.document.document_id as string
}

describe('document-tree commands (Postgres row-lock serialization)', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([TreeCollectionConfig])
    commandBuilders = testDB.commandBuilders
    dbManager = testDB.dbManager
    txManager = testDB.txManager
    pool = testDB.pool

    const tree = await commandBuilders.collections.create(
      TreeCollectionConfig.path,
      TreeCollectionConfig
    )
    if (tree[0] == null) throw new Error('Failed to create test collection')
    treeCollection = { id: tree[0].id }
  })

  afterAll(async () => {
    try {
      await commandBuilders.collections.delete(treeCollection.id)
    } catch (error) {
      console.error('Failed to cleanup test collection:', error)
    }
    await teardownTestDB()
  })

  it('serializes direct soft deletion before endpoint validation', async () => {
    const node = await createDoc(treeCollection.id, TreeCollectionConfig, 'Concurrent Delete Node')
    let releaseVersionLock: (() => void) | undefined
    let versionLocked: (() => void) | undefined
    const holdVersionLock = new Promise<void>((resolve) => {
      releaseVersionLock = resolve
    })
    const hasVersionLock = new Promise<void>((resolve) => {
      versionLocked = resolve
    })

    // Hold the version row so softDeleteDocument pauses only after taking the
    // collection lock. A concurrent placement must then wait and validate the
    // committed deleted state rather than slipping through the gap.
    const blocker = txManager.withTransaction(async () => {
      await dbManager.get().execute(sql`
        SELECT id FROM byline_document_versions
        WHERE document_id = ${node}::uuid
        FOR UPDATE
      `)
      versionLocked?.()
      await holdVersionLock
    })
    await hasVersionLock

    const deleting = commandBuilders.documents.softDeleteDocument({ document_id: node })

    const waitForDeleteCollectionLock = async (): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await pool.query(
            'SELECT id FROM byline_collections WHERE id = $1::uuid FOR UPDATE NOWAIT',
            [treeCollection.id]
          )
        } catch (error) {
          if ((error as { code?: string }).code === '55P03') return
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('soft delete did not acquire the collection lock')
    }
    await waitForDeleteCollectionLock()

    let placementSettled = false
    const placement = commandBuilders.documents
      .placeTreeNode({
        collectionId: treeCollection.id,
        documentId: node,
        parentDocumentId: null,
      })
      .then(
        (value) => {
          placementSettled = true
          return { value }
        },
        (error: unknown) => {
          placementSettled = true
          return { error }
        }
      )

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(placementSettled, 'placement waits behind direct soft deletion').toBe(false)

    releaseVersionLock?.()
    await blocker
    await expect(deleting).resolves.toBeGreaterThan(0)
    const placementResult = await placement
    expect(placementResult).toMatchObject({ error: { code: ErrorCodes.CONFLICT } })
  })
})
