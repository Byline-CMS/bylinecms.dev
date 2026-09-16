# Removed block types: reconstruction and save failures

Status: confirmed in core at `1f9b32f1`; implementation fix outstanding. Tracked as [#101](https://github.com/Byline-CMS/bylinecms.dev/issues/101).

## Finding

The September 16 maintenance audit reported a page whose reconstructed `content[0]` was not an object after a block definition had been removed. The reported deletion of that scratch page resolves that record's presence in the active corpus; it does not resolve the product defect. The database audit and deletion were reported in the debugging conversation and were not independently repeated for this note.

A separate database-free reproduction against the core source confirms that removing a block type silently omits its stored rows during reconstruction. The failure is position-dependent and is not limited to documents becoming unsaveable: trailing removed blocks can disappear from a payload that passes validation and flattening.

## Reproduction

Run from `apps/webapp` with the repository dependencies installed:

```sh
node --import tsx --input-type=module <<'JS'
import { flattenFieldSetData } from '../../packages/core/src/storage/storage-flatten.ts'
import { restoreFieldSetData } from '../../packages/core/src/storage/storage-restore.ts'
import { validateDocumentFields } from '../../packages/core/src/validation/document-fields.ts'

const retired = { blockType: 'retired', fields: [{ name: 'text', type: 'text' }] }
const live = { blockType: 'live', fields: [{ name: 'text', type: 'text' }] }
const before = [{ name: 'content', type: 'blocks', blocks: [retired, live] }]
const after = [{ name: 'content', type: 'blocks', blocks: [live] }]

for (const types of [['retired', 'live'], ['live', 'retired'], ['retired']]) {
  const rows = flattenFieldSetData(before, {
    content: types.map(_type => ({ _type, text: _type })),
  }, 'en')
  const { data, warnings } = restoreFieldSetData(after, rows, 'en')
  const serialized = JSON.parse(JSON.stringify(data))
  let nextRows
  try {
    nextRows = flattenFieldSetData(after, data, 'en').map(row => row.field_path.join('.'))
  } catch (error) {
    nextRows = error.message
  }
  console.log({
    types, warnings, data: serialized,
    directIssues: validateDocumentFields(after, data),
    serializedIssues: validateDocumentFields(after, serialized),
    nextRows,
  })
}
JS
```

Observed results:

- `[retired, live]`: no reconstruction warnings; array index 0 is absent. Direct validation passes because `forEach` skips the hole. After JSON serialization, validation reports `content[0]: Item must be an object`. Direct flattening throws on the undefined item.
- `[live, retired]`: no reconstruction warnings; the array contains only `live`. Both validation forms pass, and flattening emits only the live block's rows.
- `[retired]`: no reconstruction warnings; the required blocks field becomes `[]`. Both validation forms pass, and flattening emits no rows.

The reproduction above was re-run independently at `1f9b32f1`, including the sparse-array case (`0 in content === false`, length 2) and the flattening failure (`Cannot destructure property '_id' of 'items[i]' as it is undefined`). This demonstrates core reconstruction, validation, and flattening behavior. It does not exercise an adapter transaction, admin transport, or public renderer. Existing historical rows are not deleted by these functions.

## Read paths and the intended behaviour

Reads never fail and never warn. Every consumer that walks the blocks array skips the missing item: `restoreFieldSetData` returns without a warning, the admin editor's blocks field returns `null` for an item that is not an object with a string `_type`, the public `RenderBlocks` relies on `Array.prototype.map` skipping holes, and `buildSearchDocument` and `documentToMarkdown` both coerce a missing item to `{}` and `continue`. The document therefore opens everywhere while containing less than storage holds.

Serialization decides whether the omission stays invisible, and the three serializers in use disagree:

- **seroval** (TanStack Start's transport) preserves the hole — it encodes `[,{…}]`, and `0 in array` remains `false` across a round trip.
- **Keyv with `KeyvCacheableMemory`** (`apps/webapp/src/lib/cache/cache-manager.ts`) compacts the array: storing length 2 with an empty slot at index 0 returns length 1 with the surviving block at index 0, so a cache hit and a cache miss produce different arrays.
- **JSON** turns the hole into `null`, which `map` does not skip; `RenderBlocks` then throws `Cannot read properties of null (reading '_type')` and validation reports `content[0]: Item must be an object`.

Read-side degradation is intended and must survive a fix. A retired block type must not fail a public page or lock an editor out of the surrounding content. What is missing on the read side is the signal, not the failure: the omission should be diagnosable — logged, and shown to an editor at the block's position — rather than fatal. The defect is the write path (a save that drops the content with no signal, and a destructure error on a sparse hole), the disagreement between serializers, and the absence of any report.

## Implementation references

- `packages/core/src/storage/storage-restore.ts:248-251`: `restoreBlocksFieldData` returns without a warning when the live definition does not declare the stored block type; surviving items use their original indices. The silence is deliberate and commented — `// Block type was removed from the schema; silently skip orphaned rows.` — while every adjacent branch in the same function pushes a warning. A fix therefore changes a recorded decision rather than repairing an oversight, and should say why the decision no longer holds.
- `packages/core/src/validation/document-fields.ts`: block validation uses `value.forEach`, skipping sparse slots.
- `packages/core/src/storage/storage-flatten.ts`: block flattening iterates every index and destructures the item; omitted trailing blocks produce no rows.
- `docs/04-collections/08-collection-versioning.md`: reads use the current definition regardless of recorded `collection_version`.
- `packages/admin/src/fields/blocks/blocks-field.tsx`: `renderItem` returns `null` for malformed items and undeclared block types, so a UI-only warning cannot rely on the current rendering behavior.
- `packages/admin/src/forms/form-page-chrome.tsx`: the existing `restoreWarnings` banner provides document-level diagnostics, but there is no positional recovery card for unknown blocks.

## Proposed editor recovery strategy

An editable read should preserve each unknown block's position and stable identity and return a structured reconstruction issue describing the missing type. The editor should render an error card at that position while showing the supported content around it. A document-level banner should summarize the issues and link to those cards. A generic banner alone does not tell an editor what disappeared or where it belongs.

Suggested card copy:

> **This block type is unavailable**
>
> This document contains a `retired` block that is no longer declared by this collection. Its stored content is retained, but Byline cannot display or edit it with the current schema. Saving is blocked until the block definition is restored or the content is explicitly migrated or removed.

The recovery contract must be enforced on the server as well as in the editor:

- Detect unknown blocks from their stored rows, including removed trailing and only blocks. A client array with gaps is not a sufficient record of what storage contained.
- Keep recovery metadata separate from ordinary valid schema data. Do not accept an editor placeholder as a normal block or trust a client-supplied flag to authorize omission.
- Initially refuse content saves and new publication while reconstruction is incomplete. Show the rest of the document for inspection; any ability to save edits to supported blocks depends on a later, verified mechanism for carrying opaque content forward without loss. Existing metadata-only operations need a separately specified policy.
- Check the stored document and observed revision when applying a repair. Concurrent schema or content changes must not let an old recovery decision discard newly changed data.
- Offer an explicit recovery action only when it has defined semantics: restoring the original block definition, a developer-supplied migration, or deliberate removal of that block. Removal must identify the exact item, be permission-checked and audited, and retain the original immutable version. It must not require deleting the whole document.
- Keep public reads serving. Delivery renders the supported content around an unavailable block rather than failing; this is a settled decision, not an open option. Do not expose internal schema diagnostics or a developer recovery card to public visitors — the diagnostic belongs in logs and in the editor.

This is a proposed first stage. Full historical-schema reconstruction is a separate capability; an editor placeholder can make current failures diagnosable without pretending that capability exists.

## Requirements for a fix

1. Surface unknown stored block types with enough document, field-path, type, and item-identity context to diagnose them. Strict and lenient reads need explicit behavior; neither should silently report a complete document after omitting content.
2. Reject sparse or null block items with actionable field issues before storage flattening.
3. Preserve unknown block identity, order, and recoverable values, or refuse a content write until an explicit migration or removal resolves them. Do not compact arrays as an automatic repair.
4. Define recovery behavior for historical versions as well as current documents. A schema version number alone cannot reconstruct an unavailable historical definition.
5. Cover first, middle, last, and only removed blocks; optional and required blocks fields; direct and serialized payloads; revision-guarded updates and restores; and both database adapters. Assert content preservation as well as validation results.
6. Verify that the editor shows each unavailable block at its original location and that direct SDK or transport calls cannot bypass the server's incomplete-reconstruction save safeguard.
7. Make the chosen representation behave identically across seroval, Keyv, and JSON. A fix confined to the sparse array in core leaves those three disagreeing about what a document contains.

The choice between retained compatibility definitions, explicit migrations, and an opaque representation for unknown blocks remains a design decision. The acceptance criteria above do not prescribe a new public data shape.
