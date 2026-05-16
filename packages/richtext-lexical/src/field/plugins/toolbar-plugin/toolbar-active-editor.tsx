'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { createContext, useContext } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'

const ToolbarActiveEditorContext = createContext<LexicalEditor | null>(null)

/**
 * Provider used by the toolbar plugin to expose the *active* Lexical
 * editor (the editor for the current selection — may be a nested
 * composer's editor) to contributed toolbar items.
 */
export function ToolbarActiveEditorProvider({
  editor,
  children,
}: {
  editor: LexicalEditor
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ToolbarActiveEditorContext.Provider value={editor}>
      {children}
    </ToolbarActiveEditorContext.Provider>
  )
}

/**
 * Returns the editor a toolbar contribution should dispatch commands on.
 * Falls back to the root composer editor when called outside the
 * toolbar's provider, so contributions remain usable in standalone
 * test/preview contexts.
 */
export function useToolbarActiveEditor(): LexicalEditor {
  const fromToolbar = useContext(ToolbarActiveEditorContext)
  const [composerEditor] = useLexicalComposerContext()
  return fromToolbar ?? composerEditor
}
