/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Document-tree server functions for `tree: true` collections — the transport
 * behind the sidebar tree-placement widget. Thin wrappers over the
 * `@byline/client` tree API, which asserts the actor ability, enforces the
 * cycle / same-collection invariants, and fires the `afterTreeChange`
 * invalidation hook. See docs/DOCUMENT-TREE.md.
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger } from '@byline/core'

import { ensureCollection } from '../../integrations/api-utils.js'
import { getAdminBylineClient } from '../../integrations/byline-client.js'

// ---------------------------------------------------------------------------
// Place / move a node within the tree (place / reorder / re-parent)
// ---------------------------------------------------------------------------

export const placeTreeNode = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      collection: string
      documentId: string
      parentDocumentId: string | null
      beforeDocumentId?: string | null
      afterDocumentId?: string | null
    }) => input
  )
  .handler(async ({ data }) => {
    const { collection: path, documentId } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }
    const handle = getAdminBylineClient().collection(path)
    const result = await handle.placeTreeNode(documentId, {
      parentDocumentId: data.parentDocumentId,
      beforeDocumentId: data.beforeDocumentId ?? null,
      afterDocumentId: data.afterDocumentId ?? null,
    })
    return { status: 'ok' as const, orderKey: result.orderKey }
  })

// ---------------------------------------------------------------------------
// Remove a node from the tree (back to the unplaced state)
// ---------------------------------------------------------------------------

export const removeFromTree = createServerFn({ method: 'POST' })
  .validator((input: { collection: string; documentId: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, documentId } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }
    await getAdminBylineClient().collection(path).removeFromTree(documentId)
    return { status: 'ok' as const }
  })

// ---------------------------------------------------------------------------
// Resolve a document's ancestor chain (root-first), hydrated with titles
// ---------------------------------------------------------------------------

export const getTreeAncestors = createServerFn({ method: 'GET' })
  .validator((input: { collection: string; documentId: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, documentId } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }
    const useAsTitle = config.definition.useAsTitle
    // Admin context: read with `status: 'any'` so draft ancestors still show.
    const ancestors = await getAdminBylineClient()
      .collection(path)
      .getAncestors(documentId, { status: 'any' })
    return ancestors.map((doc) => {
      const fields = doc.fields as Record<string, any> | undefined
      const title = useAsTitle ? fields?.[useAsTitle] : undefined
      return {
        id: doc.id,
        title: typeof title === 'string' && title.length > 0 ? title : doc.path,
        path: doc.path,
      }
    })
  })

// ---------------------------------------------------------------------------
// Resolve a document's placement state in the tree (unplaced / root / child)
// ---------------------------------------------------------------------------

export const getTreeParent = createServerFn({ method: 'GET' })
  .validator((input: { collection: string; documentId: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, documentId } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }
    return getAdminBylineClient().collection(path).getTreeParent(documentId)
  })

// ---------------------------------------------------------------------------
// Read the whole collection tree as ordered, depth-tagged rows for the built-in
// tree list view. Placed nodes come first (pre-order, root-first), then any
// *unplaced* documents (created but not yet positioned) so nothing is
// unreachable from the list. Admin reads use `status: 'any'`.
// ---------------------------------------------------------------------------

export interface CollectionTreeRow {
  id: string
  /** Parent document id, or `null` for a root or unplaced node. Drives the
   * client-side tree reconstruction for drag-to-reorder / re-parent. */
  parentId: string | null
  depth: number
  unplaced: boolean
  status: string
  path: string
  createdAt: Date
  updatedAt: Date
  fields: Record<string, any>
}

export const getCollectionTree = createServerFn({ method: 'GET' })
  .validator((input: { collection: string; locale?: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }
    const handle = getAdminBylineClient().collection(path)

    const forest = await handle.getSubtree({ status: 'any', locale: data.locale })
    const rows: CollectionTreeRow[] = []
    const placed = new Set<string>()
    const walk = (nodes: typeof forest, depth: number, parentId: string | null): void => {
      for (const node of nodes) {
        const doc = node.document
        rows.push({
          id: doc.id,
          parentId,
          depth,
          unplaced: false,
          status: doc.status,
          path: doc.path,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          fields: doc.fields as Record<string, any>,
        })
        placed.add(doc.id)
        walk(node.children, depth + 1, doc.id)
      }
    }
    walk(forest, 0, null)

    // Surface documents not yet in the tree (e.g. freshly created) so they
    // remain reachable. Trees are small by design, so a single wide read is fine.
    const all = await handle.find({ status: 'any', pageSize: 1000, _bypassBeforeRead: true })
    for (const doc of all.docs) {
      if (placed.has(doc.id)) continue
      rows.push({
        id: doc.id,
        parentId: null,
        depth: 0,
        unplaced: true,
        status: doc.status,
        path: doc.path,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        fields: doc.fields as Record<string, any>,
      })
    }

    return {
      rows,
      included: { collection: { path: config.collection.path, labels: config.definition.labels } },
    }
  })
