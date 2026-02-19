/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
