/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

'use client'

import type * as React from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { CLEAR_EDITOR_COMMAND } from 'lexical'

export function Debug(): React.JSX.Element {
  const [editor] = useLexicalComposerContext()

  function handleOnSave(): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(editor.getEditorState()))
  }

  function handleOnClear(): void {
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined)
    editor.focus()
  }

  return (
    <div className="editor-actions">
      <button type="button" onClick={handleOnSave}>
        Save
      </button>
      <button type="button" onClick={handleOnClear}>
        Clear
      </button>
    </div>
  )
}
