/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Adapter conformance coverage for lifecycle-owned atomic tree auditing. */

import { createSuperAdminContext } from '@byline/auth'
import {
  type BylineLogger,
  type DocumentLifecycleContext,
  deleteDocument,
  type IDbAdapter,
  type MultiCollectionDefinition,
  placeTreeNode,
  promoteChildrenAndRemove,
  removeFromTree,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { bounded, signal } from '../race-barrier.js'
import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()
const ACTOR_ID = '01901234-0000-7000-8000-000000000001'
const config: MultiCollectionDefinition = {
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

/**
 * Ported from `packages/db-postgres/src/modules/storage/tests/storage-document-tree-audit.test.ts`.
 * The original hand-assembled an `IDbAdapter`-shaped object over
 * `setupTestDB`'s command/query builders plus its own audit-commands/queries
 * construction and stub counter commands; `hooks.createAdapter` now supplies a
 * fully-wired adapter (real counters and audit included) directly.
 */
export function documentTreeAuditSuite(hooks: ConformanceHooks): void {
  let collectionId = ''
  let db: IDbAdapter
  let ctx: DocumentLifecycleContext
  let queries: IDbAdapter['queries']

  // Audit scenarios read their next observation before an intentional new mutation.
  async function revisionOf(documentId: string): Promise<number> {
    const revision = await db.queries.documents.getDocumentRevision({
      collection_id: collectionId,
      document_id: documentId,
    })
    if (revision === null) throw new Error('Missing audit fixture revision')
    return revision
  }

  async function createDoc(title: string): Promise<string> {
    const created = await db.commands.documents.createDocumentVersion({
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
      await hooks.truncate()
      db = await hooks.createAdapter([config])
      queries = db.queries
      const created = await db.commands.collections.create(config.path, config)
      if (created[0] == null) throw new Error('Failed to create tree audit collection')
      collectionId = created[0].id

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
        if (collectionId) await db.commands.collections.delete(collectionId)
      } catch (error) {
        console.error('Failed to cleanup tree audit collection:', error)
      }
    })

    it('persists audit actions/details for place, reparent, reorder, remove, and promotion', async () => {
      const parent = await createDoc('parent')
      const node = await createDoc('node')
      const sibling = await createDoc('sibling')

      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(parent),
        documentId: parent,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
        parentDocumentId: parent,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(sibling),
        documentId: sibling,
        parentDocumentId: parent,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
        parentDocumentId: parent,
        beforeDocumentId: sibling,
      })
      // Exact retry is a structural no-op: no write and no fifth audit row.
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
        parentDocumentId: parent,
        beforeDocumentId: sibling,
      })
      await removeFromTree(ctx, { expectedRevision: await revisionOf(node), documentId: node })

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
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(deleted),
        documentId: deleted,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(childA),
        documentId: childA,
        parentDocumentId: deleted,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(childB),
        documentId: childB,
        parentDocumentId: deleted,
      })
      await promoteChildrenAndRemove(ctx, {
        expectedRevision: await revisionOf(deleted),
        documentId: deleted,
      })

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

    it('commits only one move from a shared observation and audits that placement', async () => {
      const parentA = await createDoc('concurrent-a')
      const parentB = await createDoc('concurrent-b')
      const node = await createDoc('concurrent-node')
      await placeTreeNode(ctx, { expectedRevision: 1, documentId: parentA, parentDocumentId: null })
      await placeTreeNode(ctx, { expectedRevision: 1, documentId: parentB, parentDocumentId: null })
      const expectedRevision = await revisionOf(node)
      const observe = hooks.observeRevisionContention
      if (!observe) throw new Error('Missing connection observer')
      const ready = signal(),
        release = signal()
      const lock = db.revisions.lock.bind(db.revisions)
      const spy = vi.spyOn(db.revisions, 'lock').mockImplementationOnce(async (targets) => {
        const rows = await lock(targets)
        ready.release()
        await bounded(release.promise)
        return rows
      })
      try {
        const observation = await observe(async (waitForTwoConnections) => {
          const first = placeTreeNode(ctx, {
            expectedRevision,
            documentId: node,
            parentDocumentId: parentA,
          })
          let second: Promise<unknown> | undefined
          try {
            await bounded(ready.promise)
            second = placeTreeNode(ctx, {
              expectedRevision,
              documentId: node,
              parentDocumentId: parentB,
            })
            void second.catch(() => {})
            await bounded(waitForTwoConnections())
          } finally {
            release.release()
            const [winner, loser] = await bounded(Promise.allSettled([first, second]))
            expect(winner.status).toBe('fulfilled')
            expect(loser).toMatchObject({
              status: 'rejected',
              reason: { code: 'ERR_DOCUMENT_STALE' },
            })
          }
        })
        expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
      } finally {
        release.release()
        spy.mockRestore()
      }
      const audit = await db.queries.audit.getDocumentAuditLog({ document_id: node, page_size: 10 })
      expect(audit.entries).toHaveLength(1)
      expect(audit.entries[0]?.action).toBe('document.tree.placed')
    })

    it('returns locked pre-removal descendants to the post-commit tree event', async () => {
      const parent = await createDoc('affected-parent')
      const node = await createDoc('affected-node')
      const child = await createDoc('affected-child')
      const grandchild = await createDoc('affected-grandchild')
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(parent),
        documentId: parent,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
        parentDocumentId: parent,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(child),
        documentId: child,
        parentDocumentId: node,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(grandchild),
        documentId: grandchild,
        parentDocumentId: child,
      })
      const hook = vi.fn()
      const hookedCtx: DocumentLifecycleContext = {
        ...ctx,
        definition: { ...config, hooks: { afterTreeChange: hook } },
      }

      await removeFromTree(hookedCtx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
      })

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
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(deleted),
        documentId: deleted,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(child),
        documentId: child,
        parentDocumentId: deleted,
      })
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
                return db.commands.audit.append(input)
              },
            },
          },
        },
      }

      await expect(
        deleteDocument(failingCtx, {
          expectedRevision: await revisionOf(deleted),
          documentId: deleted,
        })
      ).rejects.toThrow('late audit failure')

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
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(parent),
        documentId: parent,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(node),
        documentId: node,
        parentDocumentId: null,
      })

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
        placeTreeNode(failingCtx, {
          expectedRevision: await revisionOf(node),
          documentId: node,
          parentDocumentId: parent,
        })
      ).rejects.toThrow('forced audit failure')

      expect(await queries.documents.getTreeParent({ document_id: node })).toEqual({
        placed: true,
        parentDocumentId: null,
      })
      const audit = await db.queries.audit?.getDocumentAuditLog({
        document_id: node,
        page_size: 10,
      })
      expect(audit?.entries.map((entry) => entry.action)).toEqual(['document.tree.placed'])
    })

    it('writes no audit row when the storage mutation fails', async () => {
      const parent = await createDoc('cycle-parent')
      const child = await createDoc('cycle-child')
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(parent),
        documentId: parent,
        parentDocumentId: null,
      })
      await placeTreeNode(ctx, {
        expectedRevision: await revisionOf(child),
        documentId: child,
        parentDocumentId: parent,
      })

      const before = await db.queries.audit?.getDocumentAuditLog({
        document_id: parent,
        page_size: 10,
      })
      await expect(
        placeTreeNode(ctx, {
          expectedRevision: await revisionOf(parent),
          documentId: parent,
          parentDocumentId: child,
        })
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
}
