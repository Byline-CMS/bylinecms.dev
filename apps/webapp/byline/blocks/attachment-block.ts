/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'

/**
 * A file attachment declared *inside* a block — the shape that exercises
 * upload-field resolution across a `blocks` hop.
 *
 * A form field path is an instance path (`content[3].file`) and carries no
 * block type: a block item holds its own `_type`. Locating the `upload`
 * config for this field therefore means reading the addressed item out of
 * form state and descending into the matching block. See
 * `packages/admin/src/forms/upload-executor.ts` and
 * `docs/04-collections/01-fields.md` §"Schema paths vs instance paths".
 *
 * `upload.context` is what makes that visible from the outside. Both
 * declarations below ride along with the upload request, and each proves a
 * different half of the resolution:
 *
 *  - `name`     — a *sibling* inside this block item. Only resolves if the
 *                 block hop landed on the right item and the right block.
 *  - `/title`   — the document root, independent of block scope. Arrives
 *                 even when block resolution has gone wrong.
 *
 * So if `title` arrives and `name` does not, the failure is specifically in
 * resolving the block, not in the context plumbing generally.
 *
 * Both fields are optional so the block can be added, saved and re-edited
 * without filling anything in — this exists to be poked at, not to model
 * real content.
 */
export const AttachmentBlock = defineBlock({
  blockType: 'attachmentBlock',
  label: 'Attachment',
  helpText: 'A named file attachment. Used to exercise uploads nested inside blocks.',
  fields: [
    {
      name: 'name',
      label: 'Name',
      type: 'text',
      optional: true,
      helpText: 'Sent alongside the upload as `upload.context` — see this block’s schema file.',
    },
    {
      name: 'file',
      label: 'File',
      type: 'file',
      optional: true,
      upload: {
        // Deliberately permissive — any file will do for a smoke test.
        maxFileSize: 20 * 1024 * 1024,
        // Sibling first, then root-absolute. Order is not significant; the
        // two are here to isolate a block-resolution failure from a general
        // context failure.
        context: ['name', '/title'],
      },
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type AttachmentBlockFields = BlockFieldData<typeof AttachmentBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use the generated `AttachmentBlockData`.
 */
export type AttachmentBlockData = BlockData<typeof AttachmentBlock>
