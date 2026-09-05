/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import { isSingleton } from '../../@types/index.js'
import { TREE_HOOK_COMMITTED_MARKER } from '../../lib/errors.js'
import { runReadSnapshot } from '../../storage/read-snapshot.js'
import { unusedRevisionStore } from '../../storage/revision-store.test-helper.js'
import { validateTreeAuditCapability } from './audit.js'
import { createDocument } from './create.js'
import { deleteDocument } from './delete.js'
import { placeTreeNode, promoteChildrenAndRemove, removeFromTree } from './tree.js'
import type {
  AuditLogAppendInput,
  IDbAdapter,
  MultiCollectionDefinition,
  TreeMutationResult,
  TreePlacementState,
} from '../../@types/index.js'
import type { BylineLogger } from '../../lib/logger.js'
import type { DocumentLifecycleContext } from './context.js'

const ACTOR_ID = '01901234-0000-7000-8000-000000000001'

interface Placement {
  parentDocumentId: string | null
  orderKey: string
}

function createHarness(
  options: {
    initial?: Record<string, Placement>
    afterTreeChange?: (ctx: any) => void | Promise<void>
    afterDelete?: (ctx: any) => void | Promise<void>
    failAudit?: boolean
    failAuditAt?: number
    failPlace?: boolean
  } = {}
) {
  let placements = new Map(Object.entries(options.initial ?? {}))
  let auditRows: AuditLogAppendInput[] = []
  let key = 0
  let writes = 0
  let deleted = false
  let revisions = new Map<string, number>()
  let transactionDepth = 0
  const calls: string[] = []

  const snapshot = (documentId: string): { state: TreePlacementState; siblings: string[] } => {
    const placement = placements.get(documentId)
    if (placement == null) {
      return {
        state: { placed: false, parentDocumentId: null, orderKey: null, index: null },
        siblings: [],
      }
    }
    const siblings = [...placements.entries()]
      .filter(([, candidate]) => candidate.parentDocumentId === placement.parentDocumentId)
      .map(([id]) => id)
    return {
      state: {
        placed: true,
        parentDocumentId: placement.parentDocumentId,
        orderKey: placement.orderKey,
        index: siblings.indexOf(documentId),
      },
      siblings,
    }
  }
  const subtree = (documentId: string): string[] => {
    const ids = [documentId]
    for (const [childId, placement] of placements) {
      if (placement.parentDocumentId === documentId) ids.push(...subtree(childId))
    }
    return ids
  }

  const place = vi.fn(
    async (params: {
      documentId: string
      parentDocumentId: string | null
      beforeDocumentId?: string | null
      afterDocumentId?: string | null
      ifUnplaced?: boolean
    }): Promise<TreeMutationResult> => {
      calls.push(`place:${params.documentId}`)
      if (options.failPlace) throw new Error('tree write failed')
      const before = snapshot(params.documentId)
      if (params.ifUnplaced && before.state.placed) {
        return {
          changed: false,
          before: before.state,
          after: before.state,
          beforeSiblingDocumentIds: before.siblings,
          beforeSubtreeDocumentIds: [],
        }
      }
      const target = [...placements.entries()]
        .filter(
          ([id, placement]) =>
            id !== params.documentId && placement.parentDocumentId === params.parentDocumentId
        )
        .map(([id]) => id)
      let index = target.length
      if (params.afterDocumentId) index = target.indexOf(params.afterDocumentId)
      else if (params.beforeDocumentId) index = target.indexOf(params.beforeDocumentId) + 1
      if (
        before.state.placed &&
        before.state.parentDocumentId === params.parentDocumentId &&
        before.state.index === index
      ) {
        return {
          changed: false,
          before: before.state,
          after: before.state,
          beforeSiblingDocumentIds: before.siblings,
          beforeSubtreeDocumentIds: [],
        }
      }
      const orderKey = `key-${++key}`
      writes++
      placements.set(params.documentId, { parentDocumentId: params.parentDocumentId, orderKey })
      return {
        changed: true,
        before: before.state,
        after: { placed: true, parentDocumentId: params.parentDocumentId, orderKey, index },
        beforeSiblingDocumentIds: before.siblings,
        beforeSubtreeDocumentIds: [],
      }
    }
  )
  const remove = vi.fn(
    async ({
      documentId,
      includeSubtree,
    }: {
      documentId: string
      includeSubtree?: boolean
    }): Promise<TreeMutationResult> => {
      calls.push(`remove:${documentId}`)
      const before = snapshot(documentId)
      if (!before.state.placed) {
        return {
          changed: false,
          before: before.state,
          after: before.state,
          beforeSiblingDocumentIds: [],
          beforeSubtreeDocumentIds: includeSubtree ? subtree(documentId) : [],
        }
      }
      placements.delete(documentId)
      writes++
      return {
        changed: true,
        before: before.state,
        after: { placed: false, parentDocumentId: null, orderKey: null, index: null },
        beforeSiblingDocumentIds: before.siblings,
        beforeSubtreeDocumentIds: includeSubtree ? subtree(documentId) : [],
      }
    }
  )
  const promote = vi.fn(async ({ documentId }: { documentId: string }) => {
    calls.push(`promote:${documentId}`)
    const parent = snapshot(documentId)
    const children = [...placements.entries()].filter(
      ([, placement]) => placement.parentDocumentId === documentId
    )
    const promoted = children.map(([childId, placement], index) => {
      const before: TreePlacementState = {
        placed: true,
        parentDocumentId: documentId,
        orderKey: placement.orderKey,
        index,
      }
      const orderKey = `key-${++key}`
      const after: TreePlacementState = {
        placed: true,
        parentDocumentId: null,
        orderKey,
        index: null,
      }
      placements.set(childId, { parentDocumentId: null, orderKey })
      return { documentId: childId, before, after }
    })
    placements.delete(documentId)
    return {
      removed: {
        changed: parent.state.placed,
        before: parent.state,
        after: { placed: false, parentDocumentId: null, orderKey: null, index: null },
        beforeSiblingDocumentIds: parent.siblings,
        beforeSubtreeDocumentIds: [],
      },
      promoted,
    }
  })
  const append = vi.fn(async (input: AuditLogAppendInput) => {
    calls.push('audit')
    if (options.failAudit || options.failAuditAt === append.mock.calls.length) {
      throw new Error('audit failed')
    }
    auditRows.push(input)
    return { id: `audit-${auditRows.length}` }
  })
  const getTreeParent = vi.fn(async ({ document_id }: { document_id: string }) => {
    const placement = placements.get(document_id)
    return placement
      ? { placed: true, parentDocumentId: placement.parentDocumentId }
      : { placed: false, parentDocumentId: null }
  })
  const getTreeChildren = vi.fn(async ({ parentDocumentId }: { parentDocumentId: string | null }) =>
    [...placements.entries()]
      .filter(([, placement]) => placement.parentDocumentId === parentDocumentId)
      .map(([document_id, placement]) => ({ document_id, order_key: placement.orderKey }))
  )
  const getTreeSubtree = vi.fn(async ({ rootDocumentId }: { rootDocumentId: string | null }) => {
    const ids =
      rootDocumentId == null
        ? [...placements.entries()]
            .filter(([, placement]) => placement.parentDocumentId == null)
            .flatMap(([id]) => subtree(id))
        : subtree(rootDocumentId)
    return ids.map((document_id) => ({ document_id }))
  })
  const withTransaction = vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
    transactionDepth++
    calls.push('tx:start')
    const placementSnapshot = new Map(placements)
    const auditSnapshot = [...auditRows]
    const deletedSnapshot = deleted
    const revisionSnapshot = new Map(revisions)
    try {
      const result = await fn()
      calls.push('tx:commit')
      return result
    } catch (error) {
      placements = placementSnapshot
      auditRows = auditSnapshot
      deleted = deletedSnapshot
      revisions = revisionSnapshot
      calls.push('tx:rollback')
      throw error
    } finally {
      transactionDepth--
    }
  })

  const definition: MultiCollectionDefinition = {
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    fields: [{ name: 'title', type: 'text' }],
    tree: true,
    hooks:
      options.afterTreeChange || options.afterDelete
        ? { afterTreeChange: options.afterTreeChange, afterDelete: options.afterDelete }
        : undefined,
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
  const db = {
    commands: {
      collections: { lockCollectionRegistration: vi.fn(async () => {}) },
      singletons: { lockSlot: vi.fn(async () => {}) },
      documents: {
        publishSchedules: {
          lockDocuments: vi.fn(async () => {}),
          cancel: vi.fn(async () => null),
          suspendForContentEdit: vi.fn(async () => ({ status: 'schedule_not_found' })),
        },
        placeTreeNode: place,
        removeFromTree: remove,
        promoteChildrenAndRemoveFromTree: promote,
        softDeleteDocument: vi.fn(async () => {
          deleted = true
          return 1
        }),
      },
      audit: { append },
    },
    queries: {
      collections: {},
      audit: {},
      singletons: {},
      documents: {
        getTreeParent,
        getTreeChildren,
        getTreeSubtree,
        getDocumentById: vi.fn(async () => ({
          document_version_id: 'version-1',
          path: '/node',
          fields: {},
        })),
        getDocumentRevision: async ({ document_id }: { document_id: string }) =>
          revisions.get(document_id) ?? 1,
        publishSchedules: {},
      },
    },
    withReadSnapshot: (fn: Parameters<IDbAdapter['withReadSnapshot']>[0]) =>
      runReadSnapshot(db.queries, fn),
    revisions: {
      ...unusedRevisionStore,
      isInTransaction: () => transactionDepth > 0,
      readStructure: async ({ documentIds, parentDocumentId }) => {
        const ids = new Set(documentIds ?? [...placements.keys()])
        if (parentDocumentId)
          for (const [id, placement] of placements)
            if (placement.parentDocumentId === parentDocumentId) ids.add(id)
        return [...ids].map((documentId) => ({
          documentId,
          revision: revisions.get(documentId) ?? 1,
          orderKey: null,
          placed: placements.has(documentId),
          parentDocumentId: placements.get(documentId)?.parentDocumentId ?? null,
          treeOrderKey: placements.get(documentId)?.orderKey ?? null,
          live: true,
        }))
      },
      lock: async (targets) =>
        targets.map((target) => ({
          documentId: target.documentId,
          collectionId: target.collectionId,
          revision: revisions.get(target.documentId) ?? 1,
          currentVersionId: 'version-1',
          status: 'draft',
          sourceLocale: 'en',
          path: '/node',
          availableLocales: ['en'],
        })),
      advance: async (locked) => {
        const revision = locked.revision + 1
        revisions.set(locked.documentId, revision)
        return { documentId: locked.documentId, revision }
      },
    } satisfies IDbAdapter['revisions'],
    withTransaction,
  } as unknown as IDbAdapter
  const ctx: DocumentLifecycleContext = {
    db,
    definition,
    collectionId: 'collection-1',
    collectionVersion: 1,
    collectionPath: definition.path,
    logger,
    defaultLocale: 'en',
    requestContext: createSuperAdminContext({ id: ACTOR_ID }),
  }

  return {
    ctx,
    calls,
    place,
    remove,
    promote,
    append,
    getTreeChildren,
    getTreeSubtree,
    withTransaction,
    auditRows: () => auditRows,
    writes: () => writes,
    deleted: () => deleted,
    placement: (documentId: string) => placements.get(documentId),
  }
}

describe('document-tree lifecycle audit contract', () => {
  it('validates the full tree audit capability only for tree-enabled collections', () => {
    const harness = createHarness()
    const unsupported = {
      ...harness.ctx.db,
      commands: {
        ...harness.ctx.db.commands,
        documents: {
          ...harness.ctx.db.commands.documents,
          promoteChildrenAndRemoveFromTree: undefined,
        },
      },
    } as unknown as IDbAdapter
    const definition = harness.ctx.definition
    if (isSingleton(definition)) {
      throw new Error('tree lifecycle harness must use a multi-document collection')
    }
    expect(() =>
      validateTreeAuditCapability([{ ...definition, tree: false }], unsupported)
    ).not.toThrow()
    expect(() => validateTreeAuditCapability([harness.ctx.definition], unsupported)).toThrow(
      /tree-enabled writes require/
    )
  })

  it('records place, reparent, and reorder actions with structural details', async () => {
    const harness = createHarness({
      initial: { left: { parentDocumentId: 'parent', orderKey: 'left-key' } },
    })

    await placeTreeNode(harness.ctx, {
      expectedRevision: 1,
      documentId: 'node',
      parentDocumentId: null,
    })
    await placeTreeNode(harness.ctx, {
      expectedRevision: 2,
      documentId: 'node',
      parentDocumentId: 'parent',
    })
    await placeTreeNode(harness.ctx, {
      expectedRevision: 3,
      documentId: 'node',
      parentDocumentId: 'parent',
      afterDocumentId: 'left',
    })

    expect(harness.auditRows().map((row) => row.action)).toEqual([
      'document.tree.placed',
      'document.tree.reparented',
      'document.tree.reordered',
    ])
    expect(harness.auditRows()[0]).toMatchObject({
      documentId: 'node',
      collectionId: 'collection-1',
      actorId: ACTOR_ID,
      actorRealm: 'admin',
      field: 'tree',
      before: { placed: false, parentDocumentId: null, orderKey: null, index: null },
      after: { placed: true, parentDocumentId: null, orderKey: 'key-1' },
    })
    expect(harness.auditRows()[2]?.after).toMatchObject({
      parentDocumentId: 'parent',
      orderKey: 'key-3',
      beforeDocumentId: null,
      afterDocumentId: 'left',
    })
    expect(harness.withTransaction).toHaveBeenCalledTimes(3)
    expect(harness.getTreeSubtree).not.toHaveBeenCalled()
  })

  it('records removal and emits no audit or storage write for an unplaced no-op', async () => {
    const harness = createHarness({
      initial: { node: { parentDocumentId: 'parent', orderKey: 'old-key' } },
    })

    await removeFromTree(harness.ctx, { expectedRevision: 1, documentId: 'node' })
    await removeFromTree(harness.ctx, { expectedRevision: 2, documentId: 'node' })

    expect(harness.remove).toHaveBeenCalledTimes(2)
    expect(harness.writes()).toBe(1)
    expect(harness.auditRows()).toHaveLength(1)
    expect(harness.auditRows()[0]).toMatchObject({
      action: 'document.tree.removed',
      field: 'tree',
      before: {
        placed: true,
        parentDocumentId: 'parent',
        orderKey: 'old-key',
        index: 0,
        mode: 'remove',
      },
      after: { placed: false, mode: 'remove' },
    })
  })

  it('emits no write, audit, or hook for a same-position placement request', async () => {
    const hook = vi.fn()
    const harness = createHarness({
      initial: {
        sibling: { parentDocumentId: null, orderKey: 'a-key' },
        node: { parentDocumentId: null, orderKey: 'b-key' },
      },
      afterTreeChange: hook,
    })

    await expect(
      placeTreeNode(harness.ctx, {
        expectedRevision: 1,
        documentId: 'node',
        parentDocumentId: null,
      })
    ).resolves.toEqual({
      orderKey: 'b-key',
      documentId: 'node',
      revision: 1,
      affectedDocuments: [],
      scheduledPublicationsNeedReconfirmation: false,
    })

    expect(harness.writes()).toBe(0)
    expect(harness.auditRows()).toEqual([])
    expect(hook).not.toHaveBeenCalled()
    expect(harness.getTreeSubtree).not.toHaveBeenCalled()
  })

  it('re-fires a coarse placement event on an explicit no-op reconciliation retry', async () => {
    const hook = vi
      .fn()
      .mockRejectedValueOnce(new Error('hook failed'))
      .mockResolvedValue(undefined)
    const harness = createHarness({ afterTreeChange: hook })

    await expect(
      placeTreeNode(harness.ctx, {
        expectedRevision: 1,
        documentId: 'node',
        parentDocumentId: null,
      })
    ).rejects.toThrow('hook failed')
    await expect(
      placeTreeNode(harness.ctx, {
        expectedRevision: 2,
        documentId: 'node',
        parentDocumentId: null,
        reconcile: true,
      })
    ).resolves.toEqual({
      orderKey: 'key-1',
      documentId: 'node',
      revision: 2,
      affectedDocuments: [],
      scheduledPublicationsNeedReconfirmation: false,
    })

    expect(harness.writes()).toBe(1)
    expect(harness.auditRows()).toHaveLength(1)
    expect(hook).toHaveBeenCalledTimes(2)
    expect(hook.mock.calls[1]?.[0]).toMatchObject({
      change: 'place',
      documentId: 'node',
      affectedDocumentIds: ['node'],
    })
  })

  it('uses locked pre-removal descendants and reconciles a failed remove event', async () => {
    const events: any[] = []
    let fail = true
    const hook = vi.fn(async (event: any) => {
      events.push(event)
      if (fail) {
        fail = false
        throw new Error('hook failed')
      }
    })
    const harness = createHarness({
      initial: {
        parent: { parentDocumentId: null, orderKey: 'parent-key' },
        node: { parentDocumentId: 'parent', orderKey: 'node-key' },
        child: { parentDocumentId: 'node', orderKey: 'child-key' },
        grandchild: { parentDocumentId: 'child', orderKey: 'grandchild-key' },
      },
      afterTreeChange: hook,
    })

    await expect(
      removeFromTree(harness.ctx, { expectedRevision: 1, documentId: 'node' })
    ).rejects.toThrow('hook failed')
    expect(events[0]?.affectedDocumentIds).toEqual(
      expect.arrayContaining(['node', 'child', 'grandchild', 'parent'])
    )

    await removeFromTree(harness.ctx, { expectedRevision: 2, documentId: 'node', reconcile: true })

    expect(harness.writes()).toBe(1)
    expect(harness.auditRows()).toHaveLength(1)
    expect(events).toHaveLength(2)
    expect(events[1]?.affectedDocumentIds).toEqual(
      expect.arrayContaining(['parent', 'node', 'child', 'grandchild'])
    )
  })

  it('records child promotion and parent removal as one atomic structural event', async () => {
    const harness = createHarness({
      initial: {
        deleted: { parentDocumentId: 'grandparent', orderKey: 'deleted-key' },
        childA: { parentDocumentId: 'deleted', orderKey: 'a-key' },
        childB: { parentDocumentId: 'deleted', orderKey: 'b-key' },
      },
    })

    await promoteChildrenAndRemove(harness.ctx, { expectedRevision: 1, documentId: 'deleted' })

    expect(harness.placement('deleted')).toBeUndefined()
    expect(harness.placement('childA')?.parentDocumentId).toBeNull()
    expect(harness.placement('childB')?.parentDocumentId).toBeNull()
    expect(harness.auditRows()).toHaveLength(3)
    expect(harness.auditRows()[2]).toMatchObject({
      documentId: 'deleted',
      action: 'document.tree.removed',
      before: { parentDocumentId: 'grandparent', mode: 'promoteChildren', children: 2 },
      after: {
        placed: false,
        mode: 'promoteChildren',
        promotedDocumentIds: ['childA', 'childB'],
      },
    })
    expect(harness.auditRows().slice(0, 2)).toEqual([
      expect.objectContaining({
        documentId: 'childA',
        action: 'document.tree.reparented',
        before: expect.objectContaining({ parentDocumentId: 'deleted', mode: 'promoteOnDelete' }),
        after: expect.objectContaining({ parentDocumentId: null, mode: 'promoteOnDelete' }),
      }),
      expect.objectContaining({
        documentId: 'childB',
        action: 'document.tree.reparented',
        before: expect.objectContaining({ parentDocumentId: 'deleted', mode: 'promoteOnDelete' }),
        after: expect.objectContaining({ parentDocumentId: null, mode: 'promoteOnDelete' }),
      }),
    ])
    expect(harness.calls).toEqual([
      'tx:start',
      'promote:deleted',
      'audit',
      'audit',
      'audit',
      'tx:commit',
    ])
  })

  it('soft-deletes, promotes children, and appends all audit rows in one transaction', async () => {
    const harness = createHarness({
      initial: {
        deleted: { parentDocumentId: null, orderKey: 'deleted-key' },
        child: { parentDocumentId: 'deleted', orderKey: 'child-key' },
      },
    })

    await expect(
      deleteDocument(harness.ctx, { expectedRevision: 1, documentId: 'deleted' })
    ).resolves.toMatchObject({
      deletedVersionCount: 1,
      documentId: 'deleted',
      revision: 2,
      outcome: 'committed',
      sideEffectFailures: [],
    })

    expect(harness.deleted()).toBe(true)
    expect(harness.placement('deleted')).toBeUndefined()
    expect(harness.placement('child')?.parentDocumentId).toBeNull()
    expect(harness.auditRows().map((row) => [row.documentId, row.action])).toEqual([
      ['deleted', 'document.deleted'],
      ['child', 'document.tree.reparented'],
      ['deleted', 'document.tree.removed'],
    ])
    expect(harness.withTransaction).toHaveBeenCalledOnce()
  })

  it('rolls back soft-delete, promotion, and every audit row on a late audit failure', async () => {
    const harness = createHarness({
      initial: {
        deleted: { parentDocumentId: null, orderKey: 'deleted-key' },
        child: { parentDocumentId: 'deleted', orderKey: 'child-key' },
      },
      failAuditAt: 3,
    })

    await expect(
      deleteDocument(harness.ctx, { expectedRevision: 1, documentId: 'deleted' })
    ).rejects.toThrow('audit failed')

    expect(harness.deleted()).toBe(false)
    expect(harness.placement('deleted')).toEqual({
      parentDocumentId: null,
      orderKey: 'deleted-key',
    })
    expect(harness.placement('child')).toEqual({
      parentDocumentId: 'deleted',
      orderKey: 'child-key',
    })
    expect(harness.auditRows()).toEqual([])
  })

  it('keeps delete, promotion, and audits committed when afterTreeChange fails', async () => {
    const afterDelete = vi.fn()
    const harness = createHarness({
      initial: {
        deleted: { parentDocumentId: null, orderKey: 'deleted-key' },
        child: { parentDocumentId: 'deleted', orderKey: 'child-key' },
      },
      afterTreeChange: async () => {
        throw new Error('hook failed')
      },
      afterDelete,
    })

    await expect(
      deleteDocument(harness.ctx, { expectedRevision: 1, documentId: 'deleted' })
    ).resolves.toMatchObject({
      deletedVersionCount: 1,
      documentId: 'deleted',
      revision: 2,
      outcome: 'committed-with-side-effect-failures',
      sideEffectFailures: [{ phase: 'afterTreeChange', code: 'ERR_UNHANDLED' }],
    })

    expect(harness.deleted()).toBe(true)
    expect(harness.placement('deleted')).toBeUndefined()
    expect(harness.placement('child')?.parentDocumentId).toBeNull()
    expect(harness.auditRows()).toHaveLength(3)
    expect(harness.calls).toContain('tx:commit')
    expect(afterDelete).toHaveBeenCalledOnce()
    expect(harness.ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'deleted' }),
      'post-commit delete side effects failed'
    )
  })

  it('attempts and serializes both failing delete hook families after commit', async () => {
    const treeError = Object.assign(new Error('tree hook failed'), { code: 'ERR_TREE_HOOK' })
    const deleteError = new Error('delete hook failed')
    const afterTreeChange = vi.fn(async () => {
      throw treeError
    })
    const afterDelete = vi.fn(async () => {
      throw deleteError
    })
    const harness = createHarness({
      initial: { deleted: { parentDocumentId: null, orderKey: 'deleted-key' } },
      afterTreeChange,
      afterDelete,
    })

    const result = await deleteDocument(harness.ctx, { expectedRevision: 1, documentId: 'deleted' })

    expect(result).toMatchObject({
      deletedVersionCount: 1,
      documentId: 'deleted',
      revision: 2,
      outcome: 'committed-with-side-effect-failures',
      sideEffectFailures: [
        { phase: 'afterTreeChange', code: 'ERR_UNHANDLED' },
        { phase: 'afterDelete', code: 'ERR_UNHANDLED' },
      ],
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(JSON.stringify(result)).not.toContain('tree hook failed')
    expect(JSON.stringify(result)).not.toContain('delete hook failed')
    expect(JSON.stringify(result)).not.toContain('ERR_TREE_HOOK')

    expect(afterTreeChange).toHaveBeenCalledOnce()
    expect(afterDelete).toHaveBeenCalledOnce()
    expect(harness.ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: treeError, documentId: 'deleted' }),
      'afterTreeChange hook failed after document delete'
    )
    expect(harness.ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: deleteError, documentId: 'deleted' }),
      'afterDelete hook failed after document delete'
    )
    expect(harness.deleted()).toBe(true)
  })

  it('returns a committed fallback when a hostile error and logger both throw', async () => {
    const hostileError = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter')
        },
      }
    )
    const harness = createHarness({
      initial: { deleted: { parentDocumentId: null, orderKey: 'deleted-key' } },
      afterDelete: async () => {
        throw hostileError
      },
    })
    const loggerError = vi.fn(() => {
      throw new Error('logger failed')
    })
    harness.ctx.logger.error = loggerError

    await expect(
      deleteDocument(harness.ctx, { expectedRevision: 1, documentId: 'deleted' })
    ).resolves.toMatchObject({
      deletedVersionCount: 1,
      documentId: 'deleted',
      revision: 2,
      outcome: 'committed-with-side-effect-failures',
      sideEffectFailures: [{ phase: 'afterDelete', code: 'ERR_UNHANDLED' }],
    })
    expect(loggerError).toHaveBeenCalledTimes(2)
    expect(harness.deleted()).toBe(true)
  })

  it('rolls back tree state when audit append fails and does not fire the hook', async () => {
    const hook = vi.fn()
    const harness = createHarness({
      initial: { node: { parentDocumentId: null, orderKey: 'old-key' } },
      failAudit: true,
      afterTreeChange: hook,
    })

    await expect(
      placeTreeNode(harness.ctx, {
        expectedRevision: 1,
        documentId: 'node',
        parentDocumentId: 'new-parent',
      })
    ).rejects.toThrow('audit failed')

    expect(harness.placement('node')).toEqual({ parentDocumentId: null, orderKey: 'old-key' })
    expect(harness.auditRows()).toEqual([])
    expect(hook).not.toHaveBeenCalled()
    expect(harness.calls).toContain('tx:rollback')
  })

  it('rolls back remove and child promotion when audit append fails', async () => {
    const removeHarness = createHarness({
      initial: { node: { parentDocumentId: 'parent', orderKey: 'old-key' } },
      failAudit: true,
    })
    await expect(
      removeFromTree(removeHarness.ctx, { expectedRevision: 1, documentId: 'node' })
    ).rejects.toThrow('audit failed')
    expect(removeHarness.placement('node')).toEqual({
      parentDocumentId: 'parent',
      orderKey: 'old-key',
    })

    const promoteHarness = createHarness({
      initial: {
        deleted: { parentDocumentId: null, orderKey: 'deleted-key' },
        child: { parentDocumentId: 'deleted', orderKey: 'child-key' },
      },
      failAudit: true,
    })
    await expect(
      promoteChildrenAndRemove(promoteHarness.ctx, { expectedRevision: 1, documentId: 'deleted' })
    ).rejects.toThrow('audit failed')
    expect(promoteHarness.placement('deleted')).toEqual({
      parentDocumentId: null,
      orderKey: 'deleted-key',
    })
    expect(promoteHarness.placement('child')).toEqual({
      parentDocumentId: 'deleted',
      orderKey: 'child-key',
    })
  })

  it('does not append audit on a failed storage mutation', async () => {
    const harness = createHarness({ failPlace: true })

    await expect(
      placeTreeNode(harness.ctx, {
        expectedRevision: 1,
        documentId: 'node',
        parentDocumentId: null,
      })
    ).rejects.toThrow('tree write failed')

    expect(harness.append).not.toHaveBeenCalled()
    expect(harness.auditRows()).toEqual([])
  })

  it('commits tree and audit data before a failing afterTreeChange hook', async () => {
    const hook = vi.fn(async () => {
      throw new Error('hook failed')
    })
    const harness = createHarness({ afterTreeChange: hook })

    await expect(
      placeTreeNode(harness.ctx, {
        expectedRevision: 1,
        documentId: 'node',
        parentDocumentId: null,
      })
    ).rejects.toMatchObject({
      name: 'BylineError',
      code: 'ERR_TREE_HOOK_COMMITTED',
      message: expect.stringMatching(
        new RegExp(
          `^${TREE_HOOK_COMMITTED_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*hook failed`
        )
      ),
    })

    expect(harness.placement('node')).toEqual({ parentDocumentId: null, orderKey: 'key-1' })
    expect(harness.auditRows()).toHaveLength(1)
    expect(harness.calls).toContain('tx:commit')
  })

  it('rejects tree create before persistence when audit capability is unsupported', async () => {
    const harness = createHarness()
    const createDocumentVersion = vi.fn(async () => ({
      document: { id: 'version-1', document_id: 'created-node' },
      fieldCount: 1,
    }))
    harness.ctx.db = {
      ...harness.ctx.db,
      commands: {
        ...harness.ctx.db.commands,
        documents: {
          ...harness.ctx.db.commands.documents,
          createDocumentVersion,
        },
        audit: undefined,
      },
      withTransaction: undefined,
    } as unknown as IDbAdapter

    await expect(
      createDocument(harness.ctx, { data: { title: 'Created' }, locale: 'en' })
    ).rejects.toMatchObject({ code: 'ERR_AUDIT_UNSUPPORTED' })

    expect(createDocumentVersion).not.toHaveBeenCalled()
    expect(harness.place).not.toHaveBeenCalled()
    expect(harness.ctx.logger.error).not.toHaveBeenCalled()
  })

  it('rolls back initiating creation and placement when its audit append fails', async () => {
    const harness = createHarness({ failAudit: true })
    const createDocumentVersion = vi.fn(async () => ({
      document: { id: 'version-1', document_id: 'created-node' },
      fieldCount: 1,
    }))
    harness.ctx.db.commands.documents.createDocumentVersion = createDocumentVersion

    await expect(
      createDocument(harness.ctx, { data: { title: 'Created' }, locale: 'en' })
    ).rejects.toThrow('audit failed')

    expect(harness.place).toHaveBeenCalledOnce()
    expect(harness.placement('created-node')).toBeUndefined()
    expect(harness.auditRows()).toEqual([])
    expect(harness.calls).toContain('tx:rollback')
  })
})
