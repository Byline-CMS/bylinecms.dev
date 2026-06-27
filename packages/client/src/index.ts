/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export {
  type AuditLogEntry,
  type AuditLogPage,
  type ChangeStatusResult,
  type CreateDocumentResult,
  type CycleRelationValue,
  createReadContext,
  type DeleteDocumentResult,
  ERR_CONFLICT,
  ERR_INVALID_TRANSITION,
  ERR_NOT_FOUND,
  ERR_READ_BUDGET_EXCEEDED,
  ERR_VALIDATION,
  type PopulatedRelationValue,
  type PopulateFieldOptions,
  type PopulateFieldSpec,
  type PopulateMap,
  type PopulateSpec,
  type ReadContext,
  type ReadMode,
  type RestoreVersionResult,
  type UnpublishResult,
  type UnresolvedRelationValue,
  type UpdateDocumentResult,
} from '@byline/core'

export { BylineClient, createBylineClient } from './client.js'
export { CollectionHandle } from './collection-handle.js'
export type {
  AuditLogOptions,
  BylineClientConfig,
  ClientDocument,
  CreateOptions,
  FilterOperators,
  FindByIdOptions,
  FindByPathOptions,
  FindOneOptions,
  FindOptions,
  FindResult,
  GetAncestorsOptions,
  GetSubtreeOptions,
  PlaceTreeNodeOptions,
  PopulatedRelation,
  SortDirection,
  SortSpec,
  TreeNode,
  UpdateOptions,
  WhereClause,
  WhereValue,
  WithPopulated,
  WithPopulatedMany,
} from './types.js'
