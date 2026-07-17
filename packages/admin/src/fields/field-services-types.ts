/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Framework-neutral function contracts that field/form components in
 * `@byline/ui` need from the host application. The host wires concrete
 * implementations via `BylineFieldServicesProvider` — typically thin
 * adapters around TanStack Start server functions, Next.js server
 * actions, or any other RPC-style transport.
 */

import type { StoredFileValue } from '@byline/core'

export interface CollectionListParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  query?: string
  locale?: string
  status?: string
  fields?: string[]
}

export interface CollectionListDoc {
  id: string
  path?: string
  [field: string]: unknown
}

export interface CollectionListResponse {
  docs: CollectionListDoc[]
  meta: { totalPages?: number; [k: string]: unknown }
  included: { collection: { id: string; [k: string]: unknown } }
}

export type GetCollectionDocumentsFn = (input: {
  collection: string
  params: CollectionListParams
}) => Promise<CollectionListResponse>

export interface UploadedFileResult {
  documentId?: string
  documentVersionId?: string
  /**
   * The persisted file value, including the `variants` array with
   * `storagePath`, `storageUrl`, `width`, `height`, and `format` for each
   * generated derivative. Single source of truth — the legacy top-level
   * `variants: { name, url }[]` is gone.
   */
  storedFile: StoredFileValue
}

export type UploadFieldFn = (
  collection: string,
  formData: FormData,
  createDocument?: boolean
) => Promise<UploadedFileResult>

// --- Document tree (the `tree: true` primitive — docs/04-collections/04-document-trees.md) -----

/** One hydrated ancestor in a document's breadcrumb trail (root-first). */
export interface TreeAncestor {
  id: string
  title: string
  path?: string
}

export interface PlaceTreeNodeInput {
  collection: string
  documentId: string
  /** The new parent; `null` makes the document a root node. */
  parentDocumentId: string | null
  /** Optional sibling neighbours (left = land after, right = land before). */
  beforeDocumentId?: string | null
  afterDocumentId?: string | null
}

/** Place / move a document within its collection's tree. */
export type PlaceTreeNodeFn = (input: PlaceTreeNodeInput) => Promise<{ orderKey: string }>

/** Remove a document from the tree (back to the unplaced state). */
export type RemoveFromTreeFn = (input: { collection: string; documentId: string }) => Promise<void>

/** Resolve a document's ancestor chain, root-first, hydrated with titles. */
export type GetTreeAncestorsFn = (input: {
  collection: string
  documentId: string
}) => Promise<TreeAncestor[]>

/**
 * Resolve a document's placement state — the tri-state (unplaced / root / child)
 * that `getTreeAncestors` cannot express (it returns `[]` for both root and
 * unplaced). `placed: false` = unplaced; `placed: true` + null parent = root.
 */
export type GetTreeParentFn = (input: {
  collection: string
  documentId: string
}) => Promise<{ placed: boolean; parentDocumentId: string | null }>

export interface BylineFieldServices {
  getCollectionDocuments: GetCollectionDocumentsFn
  uploadField: UploadFieldFn
  /**
   * Document-tree operations, consumed by the sidebar tree-placement widget.
   * Optional — only hosts that serve `tree: true` collections need to wire
   * them; the widget guards on their presence.
   */
  placeTreeNode?: PlaceTreeNodeFn
  removeFromTree?: RemoveFromTreeFn
  getTreeAncestors?: GetTreeAncestorsFn
  getTreeParent?: GetTreeParentFn
}
