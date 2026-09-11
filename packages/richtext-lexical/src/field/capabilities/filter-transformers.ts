/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Transformer } from '@lexical/markdown'
import type { LexicalEditor } from 'lexical'

/**
 * The transformers that can safely be used with this editor.
 *
 * Markdown is a second route into node creation, and it fails harder
 * than paste does. `registerMarkdownShortcuts` throws when a transformer
 * names a node class the editor has not registered, and it throws for
 * the whole pipeline rather than skipping that one transformer — so a
 * field with the table extension removed would lose Markdown entirely,
 * not just tables. The same applies to every `$convertFromMarkdownString`
 * call, which creates nodes directly.
 *
 * The membership test is `editor.hasNode`, which is exactly what
 * `registerMarkdownShortcuts` uses for its own guard, so this filter
 * cannot disagree with the check it exists to satisfy.
 *
 * Takes the list as a parameter rather than importing it: the Markdown
 * module imports this one, so reaching back for `BYLINE_TRANSFORMERS`
 * here would be a cycle.
 */
export function transformersFor(
  editor: LexicalEditor,
  transformers: ReadonlyArray<Transformer>
): Array<Transformer> {
  return transformers.filter((transformer) => {
    // `text-format` transformers act on TextNode formats and declare no
    // dependencies; they are always safe.
    const dependencies = 'dependencies' in transformer ? transformer.dependencies : undefined
    if (dependencies == null) return true
    return dependencies.every((klass) => editor.hasNode(klass))
  })
}
