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
  CanCreateInCollectionFn,
  GetCollectionDocumentsFn,
  GetCreateDocumentUrlFn,
  GetTreeAncestorsFn,
  GetTreeParentFn,
  PlaceTreeNodeFn,
  RemoveFromTreeFn,
  UploadFieldFn,
} from '@byline/admin/react'

import { getAdminRoutePath } from '../routes/admin-path.js'
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
  return serverPlaceTreeNode({ data: input })
}

const removeFromTree: RemoveFromTreeFn = async (input) => {
  return serverRemoveFromTree({ data: input })
}

const getTreeAncestors: GetTreeAncestorsFn = (input) =>
  serverGetTreeAncestors({ data: input }) as ReturnType<GetTreeAncestorsFn>

const getTreeParent: GetTreeParentFn = (input) =>
  serverGetTreeParent({ data: input }) as ReturnType<GetTreeParentFn>

const getCreateDocumentUrl: GetCreateDocumentUrlFn = (collectionPath) =>
  getAdminRoutePath('collections', collectionPath, 'create')

export const bylineFieldServices: BylineFieldServices = {
  getCollectionDocuments,
  uploadField,
  placeTreeNode,
  removeFromTree,
  getTreeAncestors,
  getTreeParent,
  getCreateDocumentUrl,
}

/** The subset of the admin session the field services need. */
export interface FieldServicesViewer {
  is_super_admin: boolean
  abilities: ReadonlyArray<string>
}

/**
 * Content-addressed memo key for the services object.
 *
 * Avoids notifying field-service context consumers when the host supplies an
 * equivalent viewer object or abilities array. Existing service functions retain
 * their module-level identity even when the containing object is rebuilt.
 * Ability order is not meaningful, so sort a copy before building the key.
 */
export function abilityFingerprint(viewer: FieldServicesViewer): string {
  if (viewer.is_super_admin) return 'super-admin'
  return [...viewer.abilities].sort().join(' ')
}

/**
 * Field services for one viewer. Call inside `useMemo`, keyed on
 * `abilityFingerprint(viewer)`.
 */
export function buildBylineFieldServices(viewer: FieldServicesViewer): BylineFieldServices {
  const canCreateInCollection: CanCreateInCollectionFn = (collectionPath) =>
    viewer.is_super_admin || viewer.abilities.includes(`collections.${collectionPath}.create`)

  return { ...bylineFieldServices, canCreateInCollection }
}
