// Patch model shared between dashboard, core and adapters

import type { CollectionDefinition } from '../@types/collection-types.js'

/** Dot-notation path addressing a field within a document. */
export type PatchPath = string

export interface BasePatch {
  opId?: string
  timestamp?: string
}

export interface FieldSetPatch extends BasePatch {
  kind: 'field.set'
  path: PatchPath
  value: unknown
}

export interface FieldClearPatch extends BasePatch {
  kind: 'field.clear'
  path: PatchPath
}

export type FieldPatch = FieldSetPatch | FieldClearPatch

export interface ArrayInsertPatch extends BasePatch {
  kind: 'array.insert'
  path: PatchPath
  index?: number
  item: unknown
}

export interface ArrayMovePatch extends BasePatch {
  kind: 'array.move'
  path: PatchPath
  itemId: string
  toIndex: number
}

export interface ArrayRemovePatch extends BasePatch {
  kind: 'array.remove'
  path: PatchPath
  itemId: string
}

export interface ArrayUpdateItemPatch extends BasePatch {
  kind: 'array.updateItem'
  path: PatchPath
  itemId: string
  patches: DocumentPatch[]
}

export type ArrayPatch = ArrayInsertPatch | ArrayMovePatch | ArrayRemovePatch | ArrayUpdateItemPatch

export interface BlockAddPatch extends BasePatch {
  kind: 'block.add'
  path: PatchPath
  index?: number
  blockType: string
  initialValue?: unknown
}

export interface BlockMovePatch extends BasePatch {
  kind: 'block.move'
  path: PatchPath
  blockId: string
  toIndex: number
}

export interface BlockRemovePatch extends BasePatch {
  kind: 'block.remove'
  path: PatchPath
  blockId: string
}

export interface BlockUpdateFieldPatch extends BasePatch {
  kind: 'block.updateField'
  path: PatchPath
  blockId: string
  fieldPath: PatchPath
  value: unknown
}

export type BlockPatch = BlockAddPatch | BlockMovePatch | BlockRemovePatch | BlockUpdateFieldPatch

export type DocumentPatch = FieldPatch | ArrayPatch | BlockPatch

export interface PatchError {
  index: number
  message: string
  patch: DocumentPatch
}

export interface ApplyPatchesResult {
  doc: unknown
  errors: PatchError[]
  warnings: PatchError[]
}

export interface PatchContext {
  definition: CollectionDefinition
}
