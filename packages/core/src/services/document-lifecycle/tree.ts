/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Atomic, audited lifecycle orchestration for document-tree mutations. */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { withLogContext } from '../../lib/logger.js'
import {
  AUDIT_ACTIONS,
  auditActor,
  requireTreeAuditCapability,
  type TreeAuditCapability,
} from './audit.js'
import { invokeHook } from './internals.js'
import type {
  CollectionDefinition,
  TreeChangeContext,
  TreeDeleteMutationResult,
  TreeMutationResult,
  TreePlacementState,
} from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

interface PlaceParams {
  documentId: string
  parentDocumentId: string | null
  beforeDocumentId?: string | null
  afterDocumentId?: string | null
  ifUnplaced?: boolean
  /** Re-fire the post-commit hook when the requested placement is already current. */
  reconcile?: boolean
}

/** Document ids of a node and descendants, read only for registered hooks. */
async function subtreeIds(
  ctx: DocumentLifecycleContext,
  rootDocumentId: string
): Promise<string[]> {
  const rows = await ctx.db.queries.documents.getTreeSubtree({
    collectionId: ctx.collectionId,
    rootDocumentId,
    readMode: 'any',
  })
  return rows.map((row) => row.document_id)
}

/** Coarse collection-wide affected set for explicit no-op reconciliation. */
async function wholeTreeIds(ctx: DocumentLifecycleContext): Promise<string[]> {
  const rows = await ctx.db.queries.documents.getTreeSubtree({
    collectionId: ctx.collectionId,
    rootDocumentId: null,
    readMode: 'any',
  })
  return rows.map((row) => row.document_id)
}

/** Document ids of one sibling group, read only for registered hooks. */
async function childIds(
  ctx: DocumentLifecycleContext,
  parentDocumentId: string | null
): Promise<string[]> {
  const rows = await ctx.db.queries.documents.getTreeChildren({
    collectionId: ctx.collectionId,
    parentDocumentId,
  })
  return rows.map((row) => row.document_id)
}

/** Invoke `afterTreeChange` after the transaction has committed. */
async function fireTreeChange(
  ctx: DocumentLifecycleContext,
  definition: CollectionDefinition,
  event: Omit<TreeChangeContext, 'collectionPath' | 'affectedDocumentIds'> & {
    affectedDocumentIds: Iterable<string>
  }
): Promise<void> {
  const hooks = await resolveHooks(definition)
  if (hooks?.afterTreeChange == null) return
  await invokeHook(hooks.afterTreeChange, {
    collectionPath: ctx.collectionPath,
    change: event.change,
    documentId: event.documentId,
    affectedDocumentIds: [...new Set(event.affectedDocumentIds)],
  })
}

function placementAction(before: TreePlacementState, parentDocumentId: string | null): string {
  if (!before.placed) return AUDIT_ACTIONS.treePlaced
  if (before.parentDocumentId !== parentDocumentId) return AUDIT_ACTIONS.treeReparented
  return AUDIT_ACTIONS.treeReordered
}

/** Append one locked place/reparent/reorder result to the audit log. */
async function appendPlacementAudit(
  ctx: DocumentLifecycleContext,
  capability: TreeAuditCapability,
  params: PlaceParams,
  mutation: TreeMutationResult
): Promise<void> {
  const actor = auditActor(ctx)
  await capability.append({
    documentId: params.documentId,
    collectionId: ctx.collectionId,
    actorId: actor.actorId,
    actorRealm: actor.actorRealm,
    action: placementAction(mutation.before, params.parentDocumentId),
    field: 'tree',
    before: mutation.before,
    after: {
      ...mutation.after,
      beforeDocumentId: params.beforeDocumentId ?? null,
      afterDocumentId: params.afterDocumentId ?? null,
    },
  })
}

/** Locked storage inspection/mutation and audit append in one transaction. */
async function auditedPlace(
  ctx: DocumentLifecycleContext,
  params: PlaceParams
): Promise<TreeMutationResult> {
  const capability = requireTreeAuditCapability(ctx.db)
  let mutation: TreeMutationResult | undefined
  await capability.withTransaction(async () => {
    mutation = await capability.place({
      collectionId: ctx.collectionId,
      documentId: params.documentId,
      parentDocumentId: params.parentDocumentId,
      beforeDocumentId: params.beforeDocumentId ?? null,
      afterDocumentId: params.afterDocumentId ?? null,
      ifUnplaced: params.ifUnplaced,
    })
    if (mutation.changed) await appendPlacementAudit(ctx, capability, params, mutation)
  })
  return mutation as TreeMutationResult
}

/** Place, re-parent, or reorder a node; explicit no-op retries may reconcile hooks. */
export async function placeTreeNode(
  ctx: DocumentLifecycleContext,
  params: PlaceParams
): Promise<{ orderKey: string }> {
  return withLogContext(
    { domain: 'services', module: 'tree', function: 'placeTreeNode' },
    async () => {
      assertActorCanPerform(ctx.requestContext, ctx.collectionPath, 'update')
      const hooks = await resolveHooks(ctx.definition)
      const wantsEvent = hooks?.afterTreeChange != null
      const mutation = await auditedPlace(ctx, params)
      const orderKey = mutation.after.orderKey
      if (orderKey == null) throw new Error('placed tree mutation did not return an order key')
      if (!mutation.changed) {
        if (wantsEvent && params.reconcile === true) {
          await fireTreeChange(ctx, ctx.definition, {
            change: 'place',
            documentId: params.documentId,
            affectedDocumentIds: await wholeTreeIds(ctx),
          })
        }
        return { orderKey }
      }

      if (wantsEvent) {
        const [subtree, newSiblings] = await Promise.all([
          subtreeIds(ctx, params.documentId),
          childIds(ctx, params.parentDocumentId),
        ])
        await fireTreeChange(ctx, ctx.definition, {
          change: 'place',
          documentId: params.documentId,
          affectedDocumentIds: [
            ...subtree,
            ...(mutation.before.parentDocumentId ? [mutation.before.parentDocumentId] : []),
            ...(params.parentDocumentId ? [params.parentDocumentId] : []),
            ...mutation.beforeSiblingDocumentIds,
            ...newSiblings,
          ],
        })
      }
      return { orderKey }
    }
  )
}

/** Best-effort create/self-heal primitive that never moves an already-placed node. */
export async function appendTreeRoot(
  ctx: DocumentLifecycleContext,
  documentId: string
): Promise<void> {
  await auditedPlace(ctx, { documentId, parentDocumentId: null, ifUnplaced: true })
}

/** Best-effort post-version repair; locked `ifUnplaced` closes the check/write race. */
export async function selfHealTreePlacement(
  ctx: DocumentLifecycleContext,
  documentId: string
): Promise<void> {
  if (ctx.definition.tree !== true) return
  try {
    await appendTreeRoot(ctx, documentId)
  } catch (err: unknown) {
    ctx.logger.error({ err, documentId }, 'failed to self-heal tree placement on update')
  }
}

/** Remove a node to the unplaced state; an already-unplaced node is a true no-op. */
export async function removeFromTree(
  ctx: DocumentLifecycleContext,
  params: { documentId: string; reconcile?: boolean }
): Promise<void> {
  return withLogContext(
    { domain: 'services', module: 'tree', function: 'removeFromTree' },
    async () => {
      assertActorCanPerform(ctx.requestContext, ctx.collectionPath, 'update')
      const hooks = await resolveHooks(ctx.definition)
      const wantsEvent = hooks?.afterTreeChange != null
      const capability = requireTreeAuditCapability(ctx.db)
      const actor = auditActor(ctx)
      let mutation: TreeMutationResult | undefined

      await capability.withTransaction(async () => {
        mutation = await capability.remove({
          collectionId: ctx.collectionId,
          documentId: params.documentId,
          includeSubtree: wantsEvent,
        })
        if (!mutation.changed) return
        await capability.append({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
          actorId: actor.actorId,
          actorRealm: actor.actorRealm,
          action: AUDIT_ACTIONS.treeRemoved,
          field: 'tree',
          before: { ...mutation.before, mode: 'remove' },
          after: { ...mutation.after, mode: 'remove' },
        })
      })

      if (!mutation || !wantsEvent) return
      if (!mutation.changed) {
        if (params.reconcile === true) {
          await fireTreeChange(ctx, ctx.definition, {
            change: 'remove',
            documentId: params.documentId,
            affectedDocumentIds: [
              ...(await wholeTreeIds(ctx)),
              ...mutation.beforeSubtreeDocumentIds,
            ],
          })
        }
        return
      }
      await fireTreeChange(ctx, ctx.definition, {
        change: 'remove',
        documentId: params.documentId,
        affectedDocumentIds: [
          ...mutation.beforeSubtreeDocumentIds,
          ...(mutation.before.parentDocumentId ? [mutation.before.parentDocumentId] : []),
          ...mutation.beforeSiblingDocumentIds,
        ],
      })
    }
  )
}

/**
 * Reconcile delete-time edges and append parent plus child-specific audit rows.
 * The caller owns the transaction; delete uses this beside soft-delete/audit.
 */
export async function reconcileTreeOnDeleteInTransaction(
  ctx: DocumentLifecycleContext,
  documentId: string,
  capability: TreeAuditCapability
): Promise<TreeDeleteMutationResult> {
  const result = await capability.promoteAndRemove({
    collectionId: ctx.collectionId,
    documentId,
  })
  const actor = auditActor(ctx)

  for (const child of result.promoted) {
    await capability.append({
      documentId: child.documentId,
      collectionId: ctx.collectionId,
      actorId: actor.actorId,
      actorRealm: actor.actorRealm,
      action: AUDIT_ACTIONS.treeReparented,
      field: 'tree',
      before: { ...child.before, mode: 'promoteOnDelete', removedParentDocumentId: documentId },
      after: { ...child.after, mode: 'promoteOnDelete', removedParentDocumentId: documentId },
    })
  }

  if (result.removed.changed || result.promoted.length > 0) {
    await capability.append({
      documentId,
      collectionId: ctx.collectionId,
      actorId: actor.actorId,
      actorRealm: actor.actorRealm,
      action: AUDIT_ACTIONS.treeRemoved,
      field: 'tree',
      before: {
        ...result.removed.before,
        mode: 'promoteChildren',
        children: result.promoted.length,
      },
      after: {
        ...result.removed.after,
        mode: 'promoteChildren',
        promotedDocumentIds: result.promoted.map((child) => child.documentId),
      },
    })
  }
  return result
}

/** Fire the promotion invalidation after its transaction commits. */
export async function firePromoteTreeChange(
  ctx: DocumentLifecycleContext,
  documentId: string,
  result: TreeDeleteMutationResult
): Promise<void> {
  const hooks = await resolveHooks(ctx.definition)
  if (hooks?.afterTreeChange == null || (!result.removed.changed && result.promoted.length === 0)) {
    return
  }
  const affected = new Set<string>([
    documentId,
    ...result.removed.beforeSiblingDocumentIds,
    ...(result.removed.before.parentDocumentId ? [result.removed.before.parentDocumentId] : []),
  ])
  for (const child of result.promoted) {
    for (const id of await subtreeIds(ctx, child.documentId)) affected.add(id)
  }
  await fireTreeChange(ctx, ctx.definition, {
    change: 'promote-on-delete',
    documentId,
    affectedDocumentIds: affected,
  })
}

/** Standalone audited reconciliation used by internal tooling and tests. */
export async function promoteChildrenAndRemove(
  ctx: DocumentLifecycleContext,
  params: { documentId: string }
): Promise<void> {
  return withLogContext(
    { domain: 'services', module: 'tree', function: 'promoteChildrenAndRemove' },
    async () => {
      const capability = requireTreeAuditCapability(ctx.db)
      let result: TreeDeleteMutationResult | undefined
      await capability.withTransaction(async () => {
        result = await reconcileTreeOnDeleteInTransaction(ctx, params.documentId, capability)
      })
      await firePromoteTreeChange(ctx, params.documentId, result as TreeDeleteMutationResult)
    }
  )
}
