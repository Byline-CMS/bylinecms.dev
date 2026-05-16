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
import { defaultExtensionsList } from './field/config/default-extensions'
import { RichTextField } from './richtext-field'
import type { ExtensionsList } from './field/config/extensions-list'
import type { EditorConfig } from './field/config/types'

/**
 * Inside `lexicalEditor((c) => ...)` the seed always carries an
 * `ExtensionsList`, so narrow the callback parameter so callers can write
 * `c.extensions.add(...)` without a non-null assertion.
 */
export type LexicalEditorConfigureInput = Omit<EditorConfig, 'extensions'> & {
  extensions: ExtensionsList
}

/**
 * Returns a `RichTextEditorComponent` with editor settings baked in. Use
 * this at the registration site in your admin config when you want to
 * customise the editor across the whole installation; per-field
 * overrides via `RichTextField.editorConfig` continue to take precedence
 * at render time.
 *
 * The `configure` callback receives a deep clone of `defaultEditorConfig`
 * with `extensions` populated from `defaultExtensionsList()`. Mutate the
 * clone freely — it's local to this call. Use the chainable
 * `c.extensions.add(...)`, `.remove(...)`, `.replace(...)`, and
 * `.configure(...)` methods to manipulate the extension graph.
 *
 * Calling `lexicalEditor()` with no argument is equivalent to
 * registering `RichTextField` directly with the package defaults.
 *
 * @example
 * ```ts
 * import { lexicalEditor, TableExtension } from '@byline/richtext-lexical'
 *
 * defineClientConfig({
 *   fields: {
 *     richText: {
 *       editor: lexicalEditor((c) => {
 *         c.extensions.remove(TableExtension)        // drop a built-in
 *         c.settings.placeholderText = 'Start writing...'
 *         return c
 *       }),
 *     },
 *   },
 * })
 * ```
 */
export function lexicalEditor(
  configure?: (config: LexicalEditorConfigureInput) => LexicalEditorConfigureInput
): RichTextEditorComponent {
  let baked: EditorConfig | undefined
  if (configure) {
    const seed: LexicalEditorConfigureInput = {
      ...cloneDeep(defaultEditorConfig),
      extensions: defaultExtensionsList(),
    }
    baked = configure(seed)
  }

  const ConfiguredEditor: RichTextEditorComponent = (props) => (
    <RichTextField {...props} editorConfig={baked} />
  )

  return ConfiguredEditor
}
