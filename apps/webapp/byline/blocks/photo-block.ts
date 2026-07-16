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
const captionEditorConfig: EditorConfig = (() => {
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

export const PhotoBlock = defineBlock({
  blockType: 'photoBlock',
  label: 'Photo Block',
  helpText: 'A block for displaying a photo with optional caption and alt text.',
  fields: [
    {
      name: 'display',
      label: 'Display',
      type: 'select',
      optional: true,
      defaultValue: 'default',
      helpText: 'Select a display option for the photo.',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Wide', value: 'wide' },
        { label: 'Full Width', value: 'full_width' },
      ],
    },
    {
      name: 'photo',
      label: 'Photo',
      type: 'relation',
      targetCollection: 'media',
      displayField: 'title',
      optional: true,
    },
    { name: 'alt', label: 'Alt', type: 'text', localized: false },
    {
      name: 'caption',
      label: 'Caption',
      type: 'richText',
      optional: true,
      localized: true,
      editorConfig: captionEditorConfig,
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type PhotoBlockFields = BlockFieldData<typeof PhotoBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use generated `PhotoBlockData` and operation-specific
 * populate overlays.
 */
export type PhotoBlockData = BlockData<typeof PhotoBlock>
