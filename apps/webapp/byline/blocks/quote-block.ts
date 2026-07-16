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
 * Settings half of the caption's tailored editor, baked directly into this
 * block's schema (JSON-safe — no React). Minimal inline formatting: the
 * block-format dropdown, alignment, inline code, undo/redo, and markdown
 * affordances all switch off. The extension half (which node extensions
 * survive — here Link/AutoLink stay so captions can carry credits) lives in
 * ./photo-block.admin.ts, registered per-block-field via `defineBlockAdmin`.
 */
const quoteTextEditorConfig: EditorConfig = (() => {
  const config = structuredClone(defaultEditorConfig)
  const o = config.settings.options
  o.textAlignment = false
  o.textStyle = false // hides the block-format dropdown (headings / lists / quote)
  o.inlineCode = false
  o.undoRedo = false
  o.markdownToggle = false
  o.markdownShortcutPlugin = false
  return config
})()

/**
 * Reference block for the per-block schema/admin split. This file is the
 * schema half (React-free, tsx-loadable); its admin counterpart
 * (`./quote-block.admin.ts`) opts `quoteText` into a plain non-AI editor via
 * `defineBlockAdmin` while the site-wide richtext registration stays
 * AI-enabled — see `byline/admin.config.ts`.
 */
export const QuoteBlock = defineBlock({
  blockType: 'quoteBlock',
  label: 'Quote Block',
  helpText: 'A block for displaying a quotation with an optional highlight and source.',
  fields: [
    {
      name: 'highlightQuote',
      label: 'Highlight Quote',
      type: 'text',
      optional: true,
      localized: true,
      helpText: 'A short pull-quote line displayed above the quotation.',
    },
    // Minimal editor, both halves: this schema helper bakes the settings
    // (no block-format dropdown, alignment, undo/redo, markdown) into
    // `editorConfig`; the extension half is registered per-block-field in
    // ./quote-block.admin.ts via `minimalRichTextAdmin()`.
    {
      name: 'quoteText',
      type: 'richText',
      label: 'Quote',
      localized: true,
      editorConfig: quoteTextEditorConfig,
    },
    {
      name: 'source',
      label: 'Source',
      type: 'text',
      optional: true,
      helpText: 'Attribution for the quotation (person, publication, …). Not localized.',
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type QuoteBlockFields = BlockFieldData<typeof QuoteBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use the generated `QuoteBlockData`.
 */
export type QuoteBlockData = BlockData<typeof QuoteBlock>
