/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Host-side adapters that bind the webapp's TanStack Start server functions
 * to the framework-neutral `BylineFieldServices` contract consumed by
 * `@byline/admin` field/form components.
 *
 * Wired into the admin route once via `<BylineFieldServicesProvider>`. A
 * future Next.js host would ship its own adapter file and Provider; the
 * @byline/admin surface is unchanged.
 */

import type {
  BylineFieldServices,
  GetCollectionDocumentsFn,
  GetTreeAncestorsFn,
  GetTreeParentFn,
  PlaceTreeNodeFn,
  RemoveFromTreeFn,
  UploadFieldFn,
} from '@byline/admin/react'

import { getCollectionDocuments as serverGetCollectionDocuments } from '../server-fns/collections/list.js'
import {
  getTreeAncestors as serverGetTreeAncestors,
  getTreeParent as serverGetTreeParent,
  placeTreeNode as serverPlaceTreeNode,
  removeFromTree as serverRemoveFromTree,
} from '../server-fns/collections/tree.js'
import { uploadField as serverUploadField } from '../server-fns/collections/upload.js'

const getCollectionDocuments: GetCollectionDocumentsFn = ({ collection, params }) =>
  serverGetCollectionDocuments({
    data: { collection, params },
  }) as ReturnType<GetCollectionDocumentsFn>

const uploadField: UploadFieldFn = (collection, formData, createDocument) =>
  serverUploadField(collection, formData, createDocument)

const placeTreeNode: PlaceTreeNodeFn = async (input) => {
  const { orderKey } = await serverPlaceTreeNode({ data: input })
  return { orderKey }
}

const removeFromTree: RemoveFromTreeFn = async (input) => {
  await serverRemoveFromTree({ data: input })
}

const getTreeAncestors: GetTreeAncestorsFn = (input) =>
  serverGetTreeAncestors({ data: input }) as ReturnType<GetTreeAncestorsFn>

const getTreeParent: GetTreeParentFn = (input) =>
  serverGetTreeParent({ data: input }) as ReturnType<GetTreeParentFn>

export const bylineFieldServices: BylineFieldServices = {
  getCollectionDocuments,
  uploadField,
  placeTreeNode,
  removeFromTree,
  getTreeAncestors,
  getTreeParent,
}
