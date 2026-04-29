/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RichTextField } from '@byline/core'
import { defaultEditorConfig, type EditorConfig } from '@byline/richtext-lexical'
import { cloneDeep } from 'lodash-es'

type Options = Partial<Omit<RichTextField, 'type' | 'editorConfig'>> & {
  /**
   * Optional callback to further customise the compact defaults. Receives a
   * mutable copy of the compact config; mutate and return, or return a new
   * object. Runs after the compact preset is applied, so callers can re-enable
   * specific options for a particular field without re-listing the full set.
   */
  configure?: (config: EditorConfig) => EditorConfig
}

/**
 * Compact preset — disables block-level features (tables, layouts,
 * admonitions, code highlight, lists, embeds, inline images, alignment) and
 * keeps a slim toolbar suitable for inline body copy like image captions,
 * byline strap-lines, or compact form fields.
 */
function applyCompactPreset(config: EditorConfig): EditorConfig {
  const o = config.settings.options
  o.textAlignment = false
  o.tablePlugin = false
  o.tableActionMenuPlugin = false
  o.tableCellBackgroundColor = false
  o.tableCellMerge = false
  o.layoutPlugin = false
  o.admonitionPlugin = false
  o.codeHighlightPlugin = false
  o.horizontalRulePlugin = false
  o.listPlugin = false
  o.checkListPlugin = false
  o.inlineImagePlugin = false
  o.autoEmbedPlugin = false
  o.floatingTextFormatToolbarPlugin = false
  o.textStyle = false
  o.inlineCode = false
  o.undoRedo = false
  return config
}

/**
 * Returns a `RichTextField` with a reduced Lexical feature set baked into
 * `editorConfig`. Use this for caption-style or otherwise constrained rich-text
 * fields where the full editor surface would be inappropriate.
 *
 * The compact preset disables tables, layouts, lists, code highlight, inline
 * images, embeds, and most secondary toolbar features while keeping bold /
 * italic / link editing and the floating link editor.
 *
 * @example
 * ```ts
 * fields: [
 *   lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),
 *   // Compact + re-enable lists for a specific field:
 *   lexicalRichTextCompact({
 *     name: 'summary',
 *     label: 'Summary',
 *     configure: (c) => {
 *       c.settings.options.listPlugin = true
 *       return c
 *     },
 *   }),
 * ]
 * ```
 */
export function lexicalRichTextCompact(options: Options = {}): RichTextField {
  const { configure, ...rest } = options
  const base = applyCompactPreset(cloneDeep(defaultEditorConfig))
  const editorConfig = configure ? configure(base) : base

  return {
    name: 'richText',
    label: 'RichText',
    ...rest,
    type: 'richText',
    editorConfig,
  }
}
