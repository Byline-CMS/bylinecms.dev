// Experimental design sketch for model vs layout vs patches
// This is not wired into runtime yet; used for exploration.
import type { DocumentPatch } from '../patches/patch-types.js'

// ---- Layout / presentation ----

export type {
  LayoutBlockPalette,
  LayoutCollection,
  LayoutFieldRef,
  LayoutRow,
  LayoutSection,
  LayoutTab,
} from '../layout/layout-types.js'

// ---- Patch model ----

export type {
  ApplyPatchesResult,
  ArrayInsertPatch,
  ArrayMovePatch,
  ArrayPatch,
  ArrayRemovePatch,
  ArrayUpdateItemPatch,
  BasePatch,
  BlockAddPatch,
  BlockMovePatch,
  BlockPatch,
  BlockRemovePatch,
  BlockUpdateFieldPatch,
  DocumentPatch,
  FieldClearPatch,
  FieldPatch,
  FieldSetPatch,
  PatchError,
  PatchPath,
} from '../patches/patch-types.js'

// ---- Example: Docs model & layout (sketch) ----

// Re-export examples so existing exploratory imports keep working.
export { DocsCollectionExample, DocsLayoutExample } from '../examples/docs-examples.js'

// ---- Minimal patch application skeleton (experimental) ----

// Re-export the real implementation so existing experimental imports keep working.
export { applyPatches, parsePatchPath, resolveFieldForPath } from '../patches/apply-patches.js'

// Tiny example to illustrate the idea; not used at runtime.
export const DocsPatchExample: DocumentPatch[] = [
  {
    kind: 'field.set',
    path: 'title',
    value: 'Updated title via patch',
  },
]
