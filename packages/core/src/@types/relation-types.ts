/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** The persisted, unpopulated value of a relation field. */
export interface RelatedDocumentValue {
  targetDocumentId: string
  targetCollectionId: string
  relationshipType?: string
  cascadeDelete?: boolean
}

/** A relation value that has not passed through population. */
export interface UnpopulatedRelationValue extends RelatedDocumentValue {
  _resolved?: never
  _cycle?: never
  document?: never
}

/** Marker used when the target was already materialised in this read request. */
export interface CycleRelationValue extends RelatedDocumentValue {
  _resolved: true
  _cycle: true
}

/** Marker used when the referenced target could not be read. */
export interface UnresolvedRelationValue extends RelatedDocumentValue {
  _resolved: false
}

/** Relation envelope used when population successfully resolves the target. */
export interface PopulatedRelationValue<TDocument = Record<string, any>>
  extends RelatedDocumentValue {
  _resolved: true
  document: TDocument
}

/** Every relation shape that can occur on the read path. */
export type RelationReadValue<TDocument = Record<string, any>> =
  | UnpopulatedRelationValue
  | PopulatedRelationValue<TDocument>
  | UnresolvedRelationValue
  | CycleRelationValue

/** Read shape for a single-target or `hasMany` relation field. */
export type RelationFieldReadValue<
  HasMany extends boolean,
  TDocument = Record<string, any>,
> = HasMany extends true ? RelationReadValue<TDocument>[] : RelationReadValue<TDocument>
