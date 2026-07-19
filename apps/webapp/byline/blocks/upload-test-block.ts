/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'

/**
 * An upload nested one level *below* a block — the deepest shape the editor
 * produces, and the one that exercises identity across two independent
 * structural axes at once.
 *
 * ```
 * uploadTestBlock
 *   caption
 *   blockFile          ← upload declared ON the block
 *   attachments[]
 *     label
 *     file             ← upload one level BELOW the block
 * ```
 *
 * Two upload fields at two depths, because they fail differently.
 *
 * `attachments[].file` is addressed through an outer block item *and* an inner
 * array item, so one pending upload depends on both staying identified while
 * the editor is rearranged around it. It covers:
 *
 *  - the outer block item surviving a reorder of sibling blocks;
 *  - the inner array item surviving a reorder within this block;
 *  - a deferred upload still targeting its own item after either reorder;
 *  - pending uploads being discarded when their item is removed;
 *  - `..` climbing exactly one scope — attachment item to block.
 *
 * `blockFile` sits directly on the block, which is the only depth where `..`
 * must *escape the block entirely* and reach the document root. That is the
 * arithmetic that breaks if a path ever carries a non-navigating segment the
 * scope calculation counts as a level: `../title` silently resolves inside the
 * block instead of at the root. It resolves correctly today; this exists so it
 * keeps doing so.
 *
 * ## Reading the result
 *
 * The `upload.context` entries are a diagnostic ladder, not a feature. Each
 * rides along with its upload request and proves one more hop, so which ones
 * arrive localises a failure without any debugging.
 *
 * On `attachments[].file`:
 *
 *  - `label`      — a sibling *inside this attachment item*. Arrives only if
 *                   the inner array item resolved correctly.
 *  - `../caption` — one scope out, the *block's* caption. Arrives only if the
 *                   outer block item resolved AND `..` climbed exactly one
 *                   level.
 *  - `/title`     — the document root, independent of all block and array
 *                   scope. Arrives even when everything above has gone wrong.
 *
 * So `/title` alone means scope resolution is broken; `/title` + `label` but no
 * `../caption` means the climb is off by one; all three means the path resolved
 * end to end.
 *
 * On `blockFile`:
 *
 *  - `caption`  — a sibling inside this block item; proves the block resolved.
 *  - `../title` — the document root, reached by climbing. Missing means `..`
 *                 stopped inside the block.
 *
 * There is deliberately no `/title` on `blockFile`: it and `../title` would
 * arrive under the same `title` key, and telling the two apart is the point.
 *
 * Reduce each list to the entry under test once the ladder has served its
 * purpose.
 *
 * Every field is optional so the block can be added, saved and re-edited
 * without filling anything in. This exists to be poked at, not to model real
 * content — remove it once uploads nested in blocks are verified, as its
 * predecessor `attachmentBlock` was (85bb65f9).
 */
export const UploadTestBlock = defineBlock({
  blockType: 'uploadTestBlock',
  label: 'Upload Test',
  helpText: 'Exercises uploads nested inside an array inside a block. Not for real content.',
  fields: [
    {
      name: 'caption',
      label: 'Caption',
      type: 'text',
      optional: true,
      helpText: 'The `../caption` target — one scope out from an attachment item.',
    },
    {
      name: 'blockFile',
      label: 'Block-level file',
      type: 'file',
      optional: true,
      helpText: 'Declared directly on the block — the depth where `..` must escape the block.',
      upload: {
        maxFileSize: 20 * 1024 * 1024,
        // `caption` is a sibling inside this block item; `../title` climbs out
        // of the block to the document root. Note there is deliberately no
        // `/title` alongside: both spellings would arrive under the same
        // `title` key, and the whole point is telling them apart.
        context: ['caption', '../title'],
      },
    },
    {
      name: 'attachments',
      label: 'Attachments',
      type: 'array',
      optional: true,
      helpText: 'Add two or more, then reorder them, to exercise inner item identity.',
      fields: [
        {
          name: 'label',
          label: 'Label',
          type: 'text',
          optional: true,
          helpText: 'Name each item distinctly — this is how a mis-targeted write shows itself.',
        },
        {
          name: 'file',
          label: 'File',
          type: 'file',
          optional: true,
          upload: {
            // Deliberately permissive — any file will do for a smoke test.
            maxFileSize: 20 * 1024 * 1024,
            // The diagnostic ladder; see this block's schema comment. Order is
            // not significant.
            context: ['label', '../caption', '/title'],
          },
        },
      ],
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type UploadTestBlockFields = BlockFieldData<typeof UploadTestBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use the generated `UploadTestBlockData`.
 */
export type UploadTestBlockData = BlockData<typeof UploadTestBlock>
