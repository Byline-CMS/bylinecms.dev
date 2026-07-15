/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Postgres integration coverage for lifecycle-owned atomic tree auditing. */

import { createSuperAdminContext } from '@byline/auth'
import {
  type BylineLogger,
  type CollectionDefinition,
  type DocumentLifecycleContext,
  deleteDocument,
  type IDbAdapter,
  placeTreeNode,
  promoteChildrenAndRemove,
  removeFromTree,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAuditCommands } from '../../audit/audit-commands.js'
import { createAuditQueries } from '../../audit/audit-queries.js'

const timestamp = Date.now()
const ACTOR_ID = '01901234-0000-7000-8000-000000000001'
const config: CollectionDefinition = {
  path: `tree-audit-${timestamp}`,
  labels: { singular: 'Tree audit', plural: 'Tree audits' },
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text' }],
  tree: true,
}

const logger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
} satisfies BylineLogger

let collectionId = ''
let db: IDbAdapter
let ctx: DocumentLifecycleContext
let commands: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queries: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>
let auditCommands: ReturnType<typeof createAuditCommands>

async function createDoc(title: string): Promise<string> {
  const created = await commands.documents.createDocumentVersion({
    collectionId,
    collectionVersion: 1,
    collectionConfig: config,
    action: 'create',
    documentData: { title },
    path: `${title.toLowerCase()}-${timestamp}`,
    locale: 'all',
    status: 'published',
  })
  return created.document.document_id as string
}

describe('document-tree lifecycle audit atomicity', () => {
  beforeAll(async () => {
    const testDb = setupTestDB([config])
    commands = testDb.commandBuilders
    queries = testDb.queryBuilders
    auditCommands = createAuditCommands(testDb.dbManager)
    const auditQueries = createAuditQueries(testDb.db)
    const created = await commands.collections.create(config.path, config)
    if (created[0] == null) throw new Error('Failed to create tree audit collection')
    collectionId = created[0].id

    db = {
      commands: {
        ...commands,
        counters: {
          ensureCounterGroup: async (groupName) => ({ groupName, sequenceName: groupName }),
          nextCounterValue: async () => 1,
          nextScopedCounterValue: async () => 1,
        },
        audit: auditCommands,
      },
      queries: { ...queries, audit: auditQueries },
      withTransaction: (fn) => testDb.txManager.withTransaction(fn),
    }
    ctx = {
      db,
      definition: config,
      collectionId,
      collectionVersion: 1,
      collectionPath: config.path,
      logger,
      defaultLocale: 'en',
      requestContext: createSuperAdminContext({ id: ACTOR_ID }),
    }
  })

  afterAll(async () => {
    try {
      if (collectionId) await commands.collections.delete(collectionId)
    } finally {
      await teardownTestDB()
    }
  })

  it('persists audit actions/details for place, reparent, reorder, remove, and promotion', async () => {
    const parent = await createDoc('parent')
    const node = await createDoc('node')
    const sibling = await createDoc('sibling')

    await placeTreeNode(ctx, { documentId: parent, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: node, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: node, parentDocumentId: parent })
    await placeTreeNode(ctx, { documentId: sibling, parentDocumentId: parent })
    await placeTreeNode(ctx, {
      documentId: node,
      parentDocumentId: parent,
      beforeDocumentId: sibling,
    })
    // Exact retry is a structural no-op: no write and no fifth audit row.
    await placeTreeNode(ctx, {
      documentId: node,
      parentDocumentId: parent,
      beforeDocumentId: sibling,
    })
    await removeFromTree(ctx, { documentId: node })

    const nodeAudit = await db.queries.audit?.getDocumentAuditLog({
      document_id: node,
      page_size: 10,
    })
    expect(nodeAudit?.entries.map((entry) => entry.action)).toEqual([
      'document.tree.removed',
      'document.tree.reordered',
      'document.tree.reparented',
      'document.tree.placed',
    ])
    expect(nodeAudit?.entries[0]).toMatchObject({
      documentId: node,
      collectionId,
      actorId: ACTOR_ID,
      actorRealm: 'admin',
      field: 'tree',
      before: { placed: true, parentDocumentId: parent, mode: 'remove' },
      after: { placed: false, mode: 'remove' },
    })
    expect(nodeAudit?.entries[1]?.after).toMatchObject({
      parentDocumentId: parent,
      beforeDocumentId: sibling,
    })

    const deleted = await createDoc('deleted')
    const childA = await createDoc('child-a')
    const childB = await createDoc('child-b')
    await placeTreeNode(ctx, { documentId: deleted, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: childA, parentDocumentId: deleted })
    await placeTreeNode(ctx, { documentId: childB, parentDocumentId: deleted })
    await promoteChildrenAndRemove(ctx, { documentId: deleted })

    expect(await queries.documents.getTreeParent({ document_id: deleted })).toEqual({
      placed: false,
      parentDocumentId: null,
    })
    expect(await queries.documents.getTreeParent({ document_id: childA })).toEqual({
      placed: true,
      parentDocumentId: null,
    })
    const promotionAudit = await db.queries.audit?.getDocumentAuditLog({
      document_id: deleted,
      page_size: 1,
    })
    expect(promotionAudit?.entries[0]).toMatchObject({
      action: 'document.tree.removed',
      before: { mode: 'promoteChildren', children: 2 },
      after: {
        placed: false,
        mode: 'promoteChildren',
        promotedDocumentIds: [childA, childB],
      },
    })
    const childAudit = await db.queries.audit?.getDocumentAuditLog({
      document_id: childA,
      page_size: 1,
    })
    expect(childAudit?.entries[0]).toMatchObject({
      action: 'document.tree.reparented',
      before: { parentDocumentId: deleted, mode: 'promoteOnDelete' },
      after: { parentDocumentId: null, mode: 'promoteOnDelete' },
    })
  })

  it('serializes concurrent moves and audits the locked predecessor state', async () => {
    const parentA = await createDoc('concurrent-a')
    const parentB = await createDoc('concurrent-b')
    const node = await createDoc('concurrent-node')
    await placeTreeNode(ctx, { documentId: parentA, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: parentB, parentDocumentId: null })

    await Promise.all([
      placeTreeNode(ctx, { documentId: node, parentDocumentId: parentA }),
      placeTreeNode(ctx, { documentId: node, parentDocumentId: parentB }),
    ])

    const audit = await db.queries.audit?.getDocumentAuditLog({ document_id: node, page_size: 10 })
    expect(audit?.entries).toHaveLength(2)
    expect(audit?.entries.map((entry) => entry.action).sort()).toEqual([
      'document.tree.placed',
      'document.tree.reparented',
    ])
    const reparent = audit?.entries.find((entry) => entry.action === 'document.tree.reparented')
    expect(reparent?.before).toMatchObject({ placed: true })
    expect((reparent?.before as { parentDocumentId: string }).parentDocumentId).not.toBe(
      (reparent?.after as { parentDocumentId: string }).parentDocumentId
    )
  })

  it('returns locked pre-removal descendants to the post-commit tree event', async () => {
    const parent = await createDoc('affected-parent')
    const node = await createDoc('affected-node')
    const child = await createDoc('affected-child')
    const grandchild = await createDoc('affected-grandchild')
    await placeTreeNode(ctx, { documentId: parent, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: node, parentDocumentId: parent })
    await placeTreeNode(ctx, { documentId: child, parentDocumentId: node })
    await placeTreeNode(ctx, { documentId: grandchild, parentDocumentId: child })
    const hook = vi.fn()
    const hookedCtx: DocumentLifecycleContext = {
      ...ctx,
      definition: { ...config, hooks: { afterTreeChange: hook } },
    }

    await removeFromTree(hookedCtx, { documentId: node })

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        change: 'remove',
        documentId: node,
        affectedDocumentIds: expect.arrayContaining([parent, node, child, grandchild]),
      })
    )
  })

  it('rolls back soft-delete, edge reconciliation, and audit rows together', async () => {
    const deleted = await createDoc('delete-rollback')
    const child = await createDoc('delete-rollback-child')
    await placeTreeNode(ctx, { documentId: deleted, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: child, parentDocumentId: deleted })
    const beforeParentAudit = await db.queries.audit?.getDocumentAuditLog({
      document_id: deleted,
      page_size: 10,
    })
    let appendCount = 0
    const failingCtx: DocumentLifecycleContext = {
      ...ctx,
      db: {
        ...db,
        commands: {
          ...db.commands,
          audit: {
            append: async (input) => {
              appendCount++
              if (appendCount === 3) throw new Error('late audit failure')
              return auditCommands.append(input)
            },
          },
        },
      },
    }

    await expect(deleteDocument(failingCtx, { documentId: deleted })).rejects.toThrow(
      'late audit failure'
    )

    expect(
      await queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: deleted,
      })
    ).not.toBeNull()
    expect(await queries.documents.getTreeParent({ document_id: deleted })).toEqual({
      placed: true,
      parentDocumentId: null,
    })
    expect(await queries.documents.getTreeParent({ document_id: child })).toEqual({
      placed: true,
      parentDocumentId: deleted,
    })
    const afterParentAudit = await db.queries.audit?.getDocumentAuditLog({
      document_id: deleted,
      page_size: 10,
    })
    expect(afterParentAudit?.entries).toEqual(beforeParentAudit?.entries)
  })

  it('rolls back the tree mutation when audit append fails', async () => {
    const parent = await createDoc('rollback-parent')
    const node = await createDoc('rollback-node')
    await placeTreeNode(ctx, { documentId: parent, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: node, parentDocumentId: null })

    const failingCtx: DocumentLifecycleContext = {
      ...ctx,
      db: {
        ...db,
        commands: {
          ...db.commands,
          audit: {
            append: async () => {
              throw new Error('forced audit failure')
            },
          },
        },
      },
    }

    await expect(
      placeTreeNode(failingCtx, { documentId: node, parentDocumentId: parent })
    ).rejects.toThrow('forced audit failure')

    expect(await queries.documents.getTreeParent({ document_id: node })).toEqual({
      placed: true,
      parentDocumentId: null,
    })
    const audit = await db.queries.audit?.getDocumentAuditLog({ document_id: node, page_size: 10 })
    expect(audit?.entries.map((entry) => entry.action)).toEqual(['document.tree.placed'])
  })

  it('writes no audit row when the storage mutation fails', async () => {
    const parent = await createDoc('cycle-parent')
    const child = await createDoc('cycle-child')
    await placeTreeNode(ctx, { documentId: parent, parentDocumentId: null })
    await placeTreeNode(ctx, { documentId: child, parentDocumentId: parent })

    const before = await db.queries.audit?.getDocumentAuditLog({
      document_id: parent,
      page_size: 10,
    })
    await expect(
      placeTreeNode(ctx, { documentId: parent, parentDocumentId: child })
    ).rejects.toThrow('move would create a cycle')
    const after = await db.queries.audit?.getDocumentAuditLog({
      document_id: parent,
      page_size: 10,
    })

    expect(after?.entries).toEqual(before?.entries)
    expect(await queries.documents.getTreeParent({ document_id: parent })).toEqual({
      placed: true,
      parentDocumentId: null,
    })
  })
})
