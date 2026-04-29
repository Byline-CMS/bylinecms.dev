/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RichTextEditorComponent } from '@byline/core'
import { cloneDeep } from 'lodash-es'

import { defaultEditorConfig } from './field/config/default'
import { RichTextField } from './richtext-field'
import type { EditorConfig } from './field/config/types'

/**
 * Returns a `RichTextEditorComponent` with editor settings baked in. Use this
 * at the registration site in `byline.admin.config.ts` when you want to
 * customise the editor across the whole installation; per-field overrides
 * via `RichTextField.editorConfig` continue to take precedence at render time.
 *
 * The `configure` callback receives a deep clone of `defaultEditorConfig` —
 * mutate and return, or return a new object. Mutating the input is safe
 * because the clone is local to this call.
 *
 * Calling `lexicalEditor()` with no argument is equivalent to registering
 * `RichTextField` directly.
 *
 * @example
 * ```ts
 * import { lexicalEditor } from '@byline/richtext-lexical'
 *
 * defineClientConfig({
 *   fields: {
 *     richText: {
 *       editor: lexicalEditor((c) => {
 *         c.settings.options.tablePlugin = false
 *         c.settings.options.codeHighlightPlugin = false
 *         return c
 *       }),
 *     },
 *   },
 * })
 * ```
 */
export function lexicalEditor(
  configure?: (config: EditorConfig) => EditorConfig
): RichTextEditorComponent {
  const baked = configure ? configure(cloneDeep(defaultEditorConfig)) : undefined

  const ConfiguredEditor: RichTextEditorComponent = (props) => (
    <RichTextField {...props} editorConfig={baked} />
  )

  return ConfiguredEditor
}
