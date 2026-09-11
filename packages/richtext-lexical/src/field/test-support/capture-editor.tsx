/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'

/**
 * Hands the composer's editor to a test. Must be rendered as a child of
 * `EditorContext` so it sits inside the composer's React tree.
 */
export function CaptureEditor({ onEditor }: { onEditor: (editor: LexicalEditor) => void }): null {
  const [editor] = useLexicalComposerContext()
  onEditor(editor)
  return null
}
