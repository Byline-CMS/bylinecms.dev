# Stable-ID Form Paths Manual E2E

Created: 2026-07-19 16:29:07 local time

Branch under test: `fix/stable-id-form-paths`

## Purpose

Verify repeating-field identity and form-store behavior through the real admin,
host adapter, patch lifecycle, upload executor, and persistence layer.

This is a manual test script. Do not run it through Playwright. For a future
test cycle, copy this file to a new file with a fresh timestamp suffix, record
the branch/commit under test, and preserve the completed result log.

## Scope

The script covers:

- create-mode reorder before the first save;
- consecutive reorders in one edit session;
- edit and removal after reorder;
- form remount through tab navigation;
- outer block reorder and nested array editing;
- deferred uploads across reorder and removal;
- relative upload context through stable outer and inner IDs;
- structural locking while uploads are executing.

## Preconditions

- The local development database is migrated and seeded.
- The webapp is running from the branch/commit under test.
- A super-admin can sign in to the admin UI.
- Use throwaway documents with unique timestamped titles.
- Do not use seeded documents required by other tests.
- For upload scenarios, use small uniquely named files so placement is easy to
  verify in both the document and storage/server logs.

Start the webapp if needed:

```sh
pnpm --filter @byline/webapp dev
```

## Test Data Convention

Use these exact values where possible:

```text
Page title: Stable ID manual <timestamp>
Questions: A, B, C
Edited questions: A edited, B edited, C edited
Outer blocks: FAQ, Quote, Code
Upload block caption: Stable upload caption <timestamp>
Attachment items: Attachment A, Attachment B
Files: stable-a-<timestamp>.txt, stable-b-<timestamp>.txt
```

Record the visible order before Save and after reload. A successful immediate
UI state is not sufficient: every persistence case must include a reload.

## 1. Create-Mode Reorder

Purpose: prove that a reorder updates full form data, because create submission
persists `data` rather than the queued patch list.

1. Open Pages and choose Create.
2. Fill the required title and summary.
3. Before the first save, open the Content tab.
4. Add an FAQ block.
5. Add three FAQ items named `A`, `B`, and `C`.
6. Move `C` above `A`.
7. Move `B` between `C` and `A`.
8. Confirm the visible order is `C, B, A`.
9. Edit `C` to `C edited` without saving first.
10. Save the document for the first time.
11. Reload the resulting edit route.
12. Open Content and confirm the exact order is `C edited, B, A`.

Expected result: the first persisted version matches the order and values that
were visible immediately before Save.

## 2. Move Then Remove Before Save

Purpose: prove that removal identifies the item currently rendered at the
selected position rather than the item that occupied that position before a
move.

1. Start with the persisted order `C edited, B, A`.
2. Move `A` to the first position.
3. Without saving, remove the first visible item, `A`.
4. Confirm the immediate order is `C edited, B`.
5. Save once.
6. Reload.
7. Confirm `A` remains absent and the order is `C edited, B`.

Expected result: the moved item is removed. No sibling is removed and the
removed item does not reappear.

## 3. Move Then Edit And Remount

Purpose: verify stable field subscriptions, field writes, and form-store state
when an item changes position and its fields later remount.

1. Start with `C edited, B`.
2. Move `B` above `C edited`.
3. Without saving, change `B` to `B edited`.
4. Switch away from Content to another tab.
5. Switch back to Content.
6. Confirm the visible order remains `B edited, C edited`.
7. Save once.
8. Reload.
9. Confirm the persisted order remains `B edited, C edited`.

Expected result: tab navigation does not restore the old order or transfer the
edit to the other item.

## 4. Outer Block Reorder

Purpose: verify stable identity across heterogeneous blocks and nested array
paths.

1. In a throwaway Page, add distinguishable FAQ, Quote, and Code blocks.
2. Enter recognizable content in every block.
3. Reorder the outer blocks twice without saving between moves.
4. Edit a field in a moved block.
5. Reorder the FAQ block's nested question array.
6. Edit a moved FAQ question.
7. Switch away from Content and back.
8. Confirm the outer block order, nested FAQ order, and edited values.
9. Save once.
10. Reload.
11. Confirm the exact outer and inner orders and all edited values.

Expected result: block type, content, and nested array values remain attached
to the same stable block/item identities through both reorder levels.

## 5. Deferred Upload Fixture

The fixture is `apps/webapp/byline/blocks/upload-test-block.ts` and has upload
fields at both relevant depths:

```text
uploadTestBlock
  caption: text
  blockFile: file
  attachments: array
    label: text
    file: upload-capable file
```

The two context ladders are:

```ts
blockFile.upload.context = ['caption', '../title']
attachments.file.upload.context = ['label', '../caption', '/title']
```

The runtime paths have these conceptual shapes:

```text
content[id=<block-id>].blockFile
content[id=<block-id>].attachments[id=<attachment-id>].file
```

For `attachments[].file`, `label` proves the inner item resolved,
`../caption` proves the outer block resolved and one parent hop was counted,
and `/title` is the scope-independent root control. All three must arrive.

For `blockFile`, `caption` proves the block resolved and `../title` must escape
the block to the document root. There is deliberately no `/title` control on
this field because both spellings would arrive under the same multipart key.

Inspect the upload request's multipart Form Data in browser developer tools,
or equivalent temporary server-hook logging. Record the received values in the
result log rather than inferring context from successful file storage.

After changing the fixture schema, run the required type generation before
testing:

```sh
pnpm byline:generate
```

Then fully stop and restart the webapp development server. Collection
definitions and upload-field candidates are reconciled into an in-memory
registry once at server startup; Vite HMR can render the new block in the
browser while the upload endpoint still holds the previous Pages definition.
A page refresh does not replace the server registry.

### 5A. Direct Block Scope Arithmetic

1. Create an upload-test block in a Page whose root title is
   `ROOT-TITLE-<timestamp>`.
2. Set the block caption to `BLOCK-CAPTION-<timestamp>`.
3. Add another block before or after it so the upload-test block is not the only
   item.
4. Move the upload-test block to a different outer position.
5. Select a uniquely named file in `Block-level file`.
6. Save once.
7. Inspect the `blockFile` upload request or hook context.
8. Confirm `caption` is `BLOCK-CAPTION-<timestamp>`.
9. Confirm `title` is `ROOT-TITLE-<timestamp>`.
10. Confirm no `label` value is present.
11. Reload and confirm the file remains on the moved upload-test block.

Expected result: `../title` escapes the block exactly once and does not resolve
to block-local data.

### 5B. Select, Then Reorder

1. Create an upload-test block with caption
   `Stable upload caption <timestamp>`.
2. Add attachment items `Attachment A` and `Attachment B`.
3. Select `stable-b-<timestamp>.txt` on Attachment B.
4. Before saving, move Attachment B above Attachment A.
5. Move the entire upload-test block to another outer block position.
6. Save once.
7. Reload.
8. Confirm the stored file remains on Attachment B.
9. Confirm Attachment A has no file.
10. Confirm the upload request received all three diagnostic values:
    `label=Attachment B`, `caption=Stable upload caption <timestamp>`, and the
    Page's root `title`.
11. Confirm no field retains a pending/blob placeholder.

Expected result: both outer and inner reorder leave the deferred upload bound
to the selected stable item.

### 5C. Reorder, Then Select

1. Start with two empty attachment items.
2. Move Attachment B above Attachment A.
3. Move the containing block.
4. Select a new uniquely named file on Attachment B after both moves.
5. Save once.
6. Reload.
7. Confirm the file is stored on Attachment B only.
8. Confirm the request received Attachment B's `label`, the containing block's
   `caption`, and the Page's root `title`.

Expected result: upload schema resolution, form lookup, and relative context
all follow stable IDs after reorder.

### 5D. Remove Pending Attachment

1. Add a new attachment item.
2. Select a uniquely named file on it.
3. Remove that attachment item before saving.
4. Save once.
5. Reload.
6. Confirm the attachment item remains absent.
7. Confirm the upload transport/hook did not run for that filename.
8. Confirm no ghost array item was created.

Expected result: removing an item clears and revokes all pending uploads below
its stable path.

### 5E. Remove Pending Block

1. Add a new upload-test block and attachment item.
2. Select a uniquely named file.
3. Remove the entire block before saving.
4. Save once.
5. Reload.
6. Confirm the block remains absent.
7. Confirm the upload transport/hook did not run for that filename.
8. Confirm no block lacking `_type` and no other ghost block was created.

Expected result: subtree cleanup applies at the outer block boundary as well as
the inner attachment boundary.

### 5F. Upload-Time Structural Lock

1. Select a valid file and click Save.
2. While the Save action displays its uploading state, attempt to drag, add,
   remove, or edit an item/block.
3. Confirm the form controls do not accept interaction until upload execution
   completes.
4. After completion, reload and confirm the original selected item owns the
   file.

Expected result: no structural edit can invalidate the pending-upload snapshot
while transport is in flight.

## Failure Reporting

For any failure, record:

- scenario and step number;
- document URL and title;
- order and visible values immediately before Save;
- order and values immediately after Save;
- order and values after reload;
- selected filename and intended item;
- actual item receiving the file;
- upload-hook caption/context output;
- browser-console error;
- server error/log excerpt;
- whether a pending/blob value or ghost item remained.

Stop after the first failure in a scenario so later actions do not obscure the
original patch/order sequence.

## Result Log

Execution date: 2026-07-19

Tester: manually executed and reported in the implementation session

Branch/commit: `fix/stable-id-form-paths` (uncommitted worktree)

| Scenario | Result | Notes / evidence |
|---|---|---|
| 1. Create-mode reorder | PASS (reported before this file was created) | |
| 2. Move then remove | PASS (reported before this file was created) | |
| 3. Move then edit/remount | PASS (reported before this file was created) | |
| 4. Outer block reorder | PASS (reported before this file was created) | |
| 5A. Direct block scope arithmetic | PASS | `blockFile`: label=`null`; caption=`Test Control when Busy`; title=`ROOT-TITLE-2026-07-19-002` |
| 5B. Select then reorder | PASS | Stable block/attachment IDs retained the intended labels and files; all three nested context values arrived |
| 5C. Reorder then select | PASS | Both attachment IDs resolved independently as `Attachment 1` and `Attachment 2`; before/after context matched |
| 5D. Remove pending attachment | PASS (reported) | No ghost item or unexpected upload observed |
| 5E. Remove pending block | PASS (reported) | No recreated block or unexpected upload observed |
| 5F. Upload-time lock | PASS (reported) | Form controls appeared correctly locked while busy |

### Observed Hook Evidence

- Block ID remained
  `89fc0156-afc1-4106-be46-455d23c36790` across all three upload fields.
- Attachment ID `824bcf1e-9e12-41de-9ea0-4d506173c610` consistently resolved
  `label=Attachment 1`.
- Attachment ID `b620b0f6-1de0-4d50-a26b-698211d838c8` consistently resolved
  `label=Attachment 2`.
- Every nested upload resolved `caption=Test Control when Busy` and
  `title=ROOT-TITLE-2026-07-19-002`.
- The direct block upload resolved the same caption/title and correctly omitted
  `label`.
- `beforeStore` and `afterStore` received the same `fieldPath`, `documentId`,
  and context values for every upload.
- Every `afterStore` event reported `processingStatus=complete` with a local
  storage path and URL.

Overall result: PASS
