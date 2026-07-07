/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Document-tree lifecycle service — the unversioned structural mutations for
 * `tree: true` collections (docs/04-collections/03-document-trees.md). Wraps the storage adapter's
 * tree commands so that, like the versioned lifecycle services, they enforce the
 * actor ability and fire a collection hook. Tree writes mint no document version
 * and touch no user fields, so the `afterTreeChange` hook is the *only*
 * invalidation signal for them.
 *
 * The hook payload is the **affected set** — not a single node — because one
 * structural change ripples: the moved node, its descendants (breadcrumb trails
 * changed), the old and new parents, and both sibling lists. Computed with a few
 * cheap tree reads around the write and emitted as one batched event.
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { withLogContext } from '../../lib/logger.js'
import { invokeHook } from './internals.js'
import type { CollectionDefinition, TreeChangeContext } from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

/** Immediate parent of a node, or `null` when it is a root or unplaced. */
async function immediateParentId(
  ctx: DocumentLifecycleContext,
  documentId: string
): Promise<string | null> {
  const ancestors = await ctx.db.queries.documents.getTreeAncestors({ document_id: documentId })
  // `getTreeAncestors` is root-first, so the last entry (depth 1) is the parent.
  return ancestors.length > 0 ? (ancestors[ancestors.length - 1]?.document_id ?? null) : null
}

/** Document ids of a node and all its descendants (status-agnostic). */
async function subtreeIds(
  ctx: DocumentLifecycleContext,
  rootDocumentId: string
): Promise<string[]> {
  const rows = await ctx.db.queries.documents.getTreeSubtree({
    collectionId: ctx.collectionId,
    rootDocumentId,
    readMode: 'any',
  })
  return rows.map((r) => r.document_id)
}

/** Document ids of a parent's immediate children (`null` = the collection roots). */
async function childIds(
  ctx: DocumentLifecycleContext,
  parentDocumentId: string | null
): Promise<string[]> {
  const rows = await ctx.db.queries.documents.getTreeChildren({
    collectionId: ctx.collectionId,
    parentDocumentId,
  })
  return rows.map((r) => r.document_id)
}

/** Resolve and fire the `afterTreeChange` hook with a de-duplicated affected set. */
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

/**
 * Place or move a node within the collection's tree (place / reorder /
 * re-parent — one upsert). Asserts the `update` ability, performs the storage
 * write, then fires `afterTreeChange` with the affected set. The affected-set
 * reads are skipped entirely when the collection declares no `afterTreeChange`
 * hook, so the event machinery adds no overhead to collections that don't
 * consume it.
 */
export async function placeTreeNode(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    parentDocumentId: string | null
    beforeDocumentId?: string | null
    afterDocumentId?: string | null
  }
): Promise<{ orderKey: string }> {
  return withLogContext(
    { domain: 'services', module: 'tree', function: 'placeTreeNode' },
    async () => {
      const { db, definition, collectionPath } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')

      const hooks = await resolveHooks(definition)
      const wantsEvent = hooks?.afterTreeChange != null

      // Affected-before: the moved node's old parent, its subtree (descendants
      // travel with it), and its old sibling group.
      const before = wantsEvent
        ? {
            oldParentId: await immediateParentId(ctx, params.documentId),
            subtree: await subtreeIds(ctx, params.documentId),
          }
        : null
      const oldSiblings = before ? await childIds(ctx, before.oldParentId) : []

      const result = await db.commands.documents.placeTreeNode({
        collectionId: ctx.collectionId,
        documentId: params.documentId,
        parentDocumentId: params.parentDocumentId,
        beforeDocumentId: params.beforeDocumentId ?? null,
        afterDocumentId: params.afterDocumentId ?? null,
      })

      if (before) {
        const newSiblings = await childIds(ctx, params.parentDocumentId)
        await fireTreeChange(ctx, definition, {
          change: 'place',
          documentId: params.documentId,
          affectedDocumentIds: [
            params.documentId,
            ...before.subtree,
            ...(before.oldParentId ? [before.oldParentId] : []),
            ...(params.parentDocumentId ? [params.parentDocumentId] : []),
            ...oldSiblings,
            ...newSiblings,
          ],
        })
      }

      return result
    }
  )
}

/**
 * Remove a node from the tree (back to the *unplaced* state). Asserts `update`,
 * performs the storage delete, then fires `afterTreeChange`. Distinct from
 * deleting the document.
 */
export async function removeFromTree(
  ctx: DocumentLifecycleContext,
  params: { documentId: string }
): Promise<void> {
  return withLogContext(
    { domain: 'services', module: 'tree', function: 'removeFromTree' },
    async () => {
      const { db, definition, collectionPath } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')

      const hooks = await resolveHooks(definition)
      const wantsEvent = hooks?.afterTreeChange != null

      const oldParentId = wantsEvent ? await immediateParentId(ctx, params.documentId) : null
      const subtree = wantsEvent ? await subtreeIds(ctx, params.documentId) : []
      const oldSiblings = wantsEvent ? await childIds(ctx, oldParentId) : []

      await db.commands.documents.removeFromTree({ documentId: params.documentId })

      if (wantsEvent) {
        await fireTreeChange(ctx, definition, {
          change: 'remove',
          documentId: params.documentId,
          affectedDocumentIds: [
            params.documentId,
            ...subtree,
            ...(oldParentId ? [oldParentId] : []),
            ...oldSiblings,
          ],
        })
      }
    }
  )
}

/**
 * Promote a soft-deleted node's children to root and remove the node from the
 * tree — the application-level equivalent of the table's `parent → set null`
 * (promote) and `child → cascade` (leave) foreign keys, which only fire on a
 * *hard* row delete. Byline deletes are soft (the document row survives), so the
 * tree must be reconciled here. Fires one `afterTreeChange` (`promote-on-delete`)
 * covering the deleted node, the promoted children, and their subtrees.
 *
 * Best-effort and idempotent: a node with no children or no edge row is a no-op.
 * Called by the document delete lifecycle for `tree: true` collections.
 */
export async function promoteChildrenAndRemove(
  ctx: DocumentLifecycleContext,
  params: { documentId: string }
): Promise<void> {
  return withLogContext(
    { domain: 'services', module: 'tree', function: 'promoteChildrenAndRemove' },
    async () => {
      const { db, definition } = ctx

      // Capture the affected set before mutating: the node, its (direct)
      // children, and each child's subtree (their breadcrumbs all change as
      // they promote to root).
      const hooks = await resolveHooks(definition)
      const wantsEvent = hooks?.afterTreeChange != null

      const children = await childIds(ctx, params.documentId)
      const affected = new Set<string>([params.documentId])
      if (wantsEvent) {
        for (const childId of children) {
          for (const id of await subtreeIds(ctx, childId)) affected.add(id)
        }
      }

      // Promote each child to root. `placeTreeNode` with no neighbours mints a
      // fresh root-group key, so promoted orphans no longer carry a stale
      // per-parent key.
      for (const childId of children) {
        await db.commands.documents.placeTreeNode({
          collectionId: ctx.collectionId,
          documentId: childId,
          parentDocumentId: null,
        })
      }

      // The deleted node leaves the tree.
      await db.commands.documents.removeFromTree({ documentId: params.documentId })

      if (wantsEvent) {
        await fireTreeChange(ctx, definition, {
          change: 'promote-on-delete',
          documentId: params.documentId,
          affectedDocumentIds: affected,
        })
      }
    }
  )
}
