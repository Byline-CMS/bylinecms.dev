/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'
// Import from `/server` (data-only) rather than the package root so this
// schema file stays tsx-loadable for seeds — the root barrel evaluates the
// editor React components and their CSS imports.
import { defaultEditorConfig, type EditorConfig } from '@byline/richtext-lexical/server'

/**
 * Settings half of the answer editor, baked directly into this block's
 * schema (JSON-safe — no React), per the photo/quote block pattern:
 * compact — no alignment, block-format dropdown, inline code, or
 * undo/redo, but structural prose (lists, links via the default
 * extension set) stays, since answers are real paragraphs.
 */
const answerEditorConfig: EditorConfig = (() => {
  const config = structuredClone(defaultEditorConfig)
  const o = config.settings.options
  o.textAlignment = false
  o.textStyle = false
  o.inlineCode = false
  o.undoRedo = false
  return config
})()

/**
 * Reference block for an `array` field nested inside a block — an
 * accordion of question/answer pairs (ported from the FORRU beta
 * migration's legacy-block port). Currently also the repro for
 * ISSUE-array-fields-in-blocks.md (repo root): the `faq` array renders
 * without add / remove / drag-reorder controls in the admin.
 *
 * NOTE: `defineBlockAdmin` addresses top-level block field names only, so
 * a per-field editor (extension) override cannot reach `answer` inside
 * the array — it renders with the site-wide editor registration plus the
 * compact settings above.
 */
export const FAQBlock = defineBlock({
  blockType: 'faqBlock',
  label: 'FAQ',
  helpText: 'A block for displaying a list of questions and answers.',
  fields: [
    {
      name: 'faq',
      label: 'Questions',
      type: 'array',
      fields: [
        {
          name: 'question',
          label: 'Question',
          type: 'text',
          localized: true,
        },
        {
          name: 'answer',
          label: 'Answer',
          type: 'richText',
          localized: true,
          editorConfig: answerEditorConfig,
        },
      ],
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type FAQBlockFields = BlockFieldData<typeof FAQBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use the generated `FaqBlockData`.
 */
export type FAQBlockData = BlockData<typeof FAQBlock>
