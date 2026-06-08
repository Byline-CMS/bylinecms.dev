'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { createContext, useContext, useMemo, useRef, useState } from 'react'

interface MarkdownModeContextValue {
  /** React state — drives toolbar button active styling and re-render. */
  isMarkdown: boolean
  setIsMarkdown: (value: boolean) => void
  /**
   * Synchronous mirror of {@link isMarkdown} for non-React readers — the
   * editor's `OnChangePlugin` guard consults this to decide whether to
   * suppress form persistence. React state updates are async, so the
   * toggle handler writes the ref eagerly (before mutating the editor) to
   * guarantee the markdown-source snapshot is never emitted to the form.
   */
  markdownModeRef: React.MutableRefObject<boolean>
}

const MarkdownModeContext = createContext<MarkdownModeContextValue | null>(null)

/**
 * Holds the per-editor "view as markdown source" mode. Sits OUTSIDE the
 * Lexical composer (alongside the shared on-change / history contexts) so
 * both the in-composer editor surface and the toolbar button read the same
 * mode — and so node decorators rendered as composer siblings can see it.
 */
export function MarkdownModeProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [isMarkdown, setIsMarkdown] = useState(false)
  const markdownModeRef = useRef(false)
  const value = useMemo<MarkdownModeContextValue>(
    () => ({ isMarkdown, setIsMarkdown, markdownModeRef }),
    [isMarkdown]
  )
  return <MarkdownModeContext.Provider value={value}>{children}</MarkdownModeContext.Provider>
}

export function useMarkdownMode(): MarkdownModeContextValue {
  const ctx = useContext(MarkdownModeContext)
  if (ctx == null) {
    throw new Error('useMarkdownMode must be used within a MarkdownModeProvider')
  }
  return ctx
}
