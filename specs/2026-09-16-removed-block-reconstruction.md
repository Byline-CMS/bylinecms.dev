---
title: "Removed block types — read warnings and write policy"
path: "removed-block-reconstruction"
summary: "Agreed design for issue 101: documents holding blocks whose type was removed from the schema warn on read, render what they can, and drop the unavailable content on the next write."
---

# Removed block types — read warnings and write policy

Companions:

- [Issue #101](https://github.com/Byline-CMS/bylinecms.dev/issues/101) records the defect, the reproduction, and the decision comment.
- [Collection versioning](../docs/04-collections/08-collection-versioning.md#removed-block-types) documents the current limitation and must be updated by this work.

Status: design agreed with Tony on 2026-10-17; not implemented. This revision replaces the September 16 proposal, which blocked saves until an explicit migration or removal. The defect was confirmed in core at `1f9b32f1` and remains present at `bb3c38fa`.

## Problem

When a developer removes a block type from a collection's `blocks: [...]` declaration, the rows stored for existing instances of that block remain in the database. Reconstruction skips them without any signal (`packages/core/src/storage/storage-restore.ts:248-251`, commented `// Block type was removed from the schema; silently skip orphaned rows.`). Surviving blocks keep their original array indices, so the result depends on where the removed block sat:

| Stored order | Reconstructed | Next save |
| --- | --- | --- |
| `[retired, live]` | empty slot at index 0, `live` at 1 | `flattenFieldSetData` throws `Cannot destructure property '_id' of 'items[i]' as it is undefined`; the document cannot be saved |
| `[live, retired]` | `[live]` | succeeds and writes a version without the retired block, with no warning |
| `[retired]` | `[]` (required) or `undefined` (optional) | succeeds and writes no block rows, with no warning |

The serializers in use disagree about the sparse case: seroval (TanStack Start's transport) preserves the hole, Keyv with `KeyvCacheableMemory` compacts the array and renumbers survivors, and JSON turns the hole into `null`, which makes `RenderBlocks` throw. Nothing reports the omission at any layer.

## Decision

1. **Public reads keep working.** Delivery renders the surviving blocks and never fails a page because a block type was removed. This was settled on 2026-09-16 and is unchanged.
2. **Reads warn.** Every reconstruction that omits an unavailable block reports it: to editors in Byline's admin user interface, to SDK and MCP callers in the returned document, and to operators in the server log.
3. **Writes drop the unavailable content.** Any write that re-saves a document's content succeeds and omits the unavailable blocks from the new version. There is no acknowledgement flag, no dedicated error code, and no difference between the admin user interface, `@byline/client`, and MCP.

The reasoning: removing a block definition is a deliberate developer change. If it was intended, writes that drop the leftover content carry out that intent. If it was a mistake, the read warnings expose it quickly, and nothing is destroyed because versions are immutable — every earlier version still holds the block's rows. Recovery is to restore the block definition and then restore the last version that contained the block. Edits made to the document after the block was dropped must be redone, because a version restore replaces the whole current content; prompt warnings keep that window small.

## Design

### 1. A typed issue, separate from `warnings`

`restoreFieldSetData` currently returns `{ data, warnings }`. Unknown blocks must **not** be reported through `warnings`. Both adapters throw `ERR_DATABASE` when a non-lenient read produces any warning (`packages/db-postgres/src/modules/storage/storage-queries.ts:829`, `packages/db-mysql/src/modules/storage/storage-queries.ts:829`), and public delivery reads are non-lenient. Pushing a warning for a removed block would turn every affected public page into an error, which is the outcome decision 1 forbids. This explains the original silent skip; the fix replaces it with a separate channel rather than a warning.

Add a third return value, for example:

```ts
interface UnavailableBlock {
  /** Instance path of the blocks field, e.g. `content` or `sections[0].body`. */
  fieldPath: string
  /** The block's index in the stored array, before compaction. */
  storedIndex: number
  /** The undeclared block type, e.g. `uploadTestBlock`. */
  blockType: string
  /** The block's stable `_id` from `store_meta`, when present. */
  id?: string
}
```

Strict and lenient reads both return it; neither throws on it. Cover blocks fields nested inside groups, arrays, and other blocks.

### 2. Gap-free arrays

Reconstruction compacts each blocks array after skipping unavailable items, so a reconstructed document never contains an empty slot or a `null` block. The original positions live only in `storedIndex`. This makes seroval, Keyv, and JSON agree, and it removes the flattening crash for leading and middle removed blocks.

This deliberately reverses the guidance in the current collection-versioning documentation, which warns against "filtering empty entries" as a repair. Compaction is acceptable now because it is no longer silent: every compaction is reported through the typed issue.

### 3. Defensive validation and flattening

`validateDocumentFields` and `flattenFieldSetData` must treat an empty slot or a non-object item in a blocks array as an actionable field issue (for example `content[0]: Block item is missing`), not a destructure error. With compaction in place these paths should only see such payloads from hand-built input, but they must not crash.

### 4. Where the issue surfaces

- **Adapters and core read services** carry the issue alongside the reconstructed fields on every read path that reconstructs: `getDocumentById`, `findDocuments`, `getDocumentsByDocumentIds` (populate), history, and version reads.
- **`@byline/client`** exposes it on `ClientDocument`, following the existing `_restoreWarnings` convention (proposed name `_unavailableBlocks`), and only when non-empty. It is present on strict and lenient reads so SDK and MCP callers learn about it without opting in. It is metadata for callers, not content: public renderers ignore it, and applications must not display it to visitors.
- **Server log:** the first time a process reconstructs a given document version with unavailable blocks, log one warning naming the collection path, document id, version id, and block types. Deduplicate per process so a busy page does not flood the log.
- **MCP** (future): the read tool includes the unavailable blocks in its output so the agent can tell the user. Record this in the MCP plan.

### 5. Admin editor

- **Banner:** reuse the document-level `restoreWarnings` banner area in `packages/admin/src/forms/form-page-chrome.tsx`. Suggested copy: "This document contains 2 blocks whose type is no longer available. Their content cannot be shown or edited, and saving this document will remove it. If this is not intended, contact your site administrator before saving."
- **Placeholder card** at each unavailable block's original position in its blocks field, naming the block type: "Unavailable block: `uploadTestBlock`. This block type is no longer declared, so its content cannot be shown. Saving will remove it."
- **The card is display-only and must not occupy a slot in the form's array.** Field edits inside a block are `field.set` patches with instance paths such as `content[1].text` (`packages/admin/src/forms/form-context.tsx`), and `block.add` / `block.move` carry array indices (`packages/core/src/patches/apply-patches.ts`). The server applies patches to its own reconstruction, which is compacted. If a placeholder occupied an array slot on the client, every later index would be off by one and edits would land on the wrong block. Render cards from `storedIndex` between the real items, outside the form's array state.
- After a successful save the document has no unavailable blocks, so the banner and cards disappear on reload.
- No confirmation modal. The banner is the notice.

### 6. Writes

No new write semantics. Every operation that re-saves content — patch and whole-document updates, version restore, duplicate, copy-to-locale, delete-locale, and singleton update — already reconstructs and re-flattens, and will now omit unavailable blocks consistently instead of crashing on a leading hole. Status changes and path edits do not re-flatten content and are unaffected.

## Documentation

Rewrite "Removed block types" in `docs/04-collections/08-collection-versioning.md` to describe the shipped behavior:

- the policy: reads warn and render what they can; writes drop unavailable content;
- what editors, SDK and MCP callers, public visitors, and operators each see;
- recovery: restore the block definition, then restore the last version containing the block, with the limitation that later edits must be redone;
- the developer guidance that keeping a definition declared is the way to keep its content.

Remove the statements that diagnostics and placeholders are unresolved or proposed.

## Out of scope

- A retired or deprecated marker on block definitions.
- An acknowledgement flag, a refusal error, or blocking saves.
- Opaque passthrough of unknown block rows across writes.
- A per-block remove action (saving already removes).
- Rendering removed blocks from their historical definitions (#11, #31).
- Removed fields. Their rows are skipped by the same code (`storage-restore.ts:152`, `:209`, `:273`) and dropped on the next save. That is conventional schema-change behavior and stays as it is; it needs only a sentence in the documentation.

## Tests

- Removed block in the first, middle, last, and only position; required and optional blocks fields; a blocks field nested in a group, an array, and another block.
- The typed issue reports the correct `fieldPath`, `storedIndex`, `blockType`, and `id` in each case, and strict reads return it without throwing.
- Reconstructed arrays are gap-free, and the same document compares equal after a seroval, Keyv, and JSON round trip.
- Validation and flattening report a hand-built sparse or `null` item as a field issue instead of throwing.
- A patch save where an unavailable block precedes the edited block: the edit lands on the intended block, and the new version contains every live block and none of the unavailable ones.
- Whole-document `@byline/client` update, version restore, duplicate, copy-to-locale, delete-locale, and singleton update each omit unavailable content without error.
- A public read renders the surviving blocks and logs once per document version per process.
- Recovery: re-declaring the block definition and restoring an earlier version brings the content back.
- Both database adapters.
- Admin editor (component test plus a manual browser check): the banner and cards appear at the right positions, and disappear after save.

## Reproduction

Database-free, from `apps/webapp`. Before the fix it shows no warnings in any case, a sparse array for `[retired, live]`, and a flattening crash; after the fix it should show the typed issue in every case, gap-free arrays, and no crash.

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
  const restored = restoreFieldSetData(after, rows, 'en')
  const serialized = JSON.parse(JSON.stringify(restored.data))
  let nextRows
  try {
    nextRows = flattenFieldSetData(after, restored.data, 'en').map(row => row.field_path.join('.'))
  } catch (error) {
    nextRows = error.message
  }
  console.log({
    types, restored: { ...restored, data: serialized },
    directIssues: validateDocumentFields(after, restored.data),
    serializedIssues: validateDocumentFields(after, serialized),
    nextRows,
  })
}
JS
```

## Implementation references

- `packages/core/src/storage/storage-restore.ts` — `restoreBlocksFieldData` skip and the `{ data, warnings }` contract.
- `packages/db-postgres/src/modules/storage/storage-queries.ts` and `packages/db-mysql/src/modules/storage/storage-queries.ts` — `reconstructFromUnifiedRows`, the strict-read throw, and `restoreWarnings` propagation.
- `packages/client/src/types.ts` — `_restoreWarnings` on `ClientDocument`.
- `packages/core/src/validation/document-fields.ts` — block validation uses `forEach`, which skips holes.
- `packages/core/src/storage/storage-flatten.ts` — block flattening destructures each item.
- `packages/core/src/patches/apply-patches.ts` — block patch addressing.
- `packages/admin/src/fields/blocks/blocks-field.tsx` — `renderItem` returns `null` for undeclared types.
- `packages/admin/src/forms/form-page-chrome.tsx` — document-level warning banner.
- `apps/webapp/src/ui/byline/render-blocks.tsx` — public block renderer.
