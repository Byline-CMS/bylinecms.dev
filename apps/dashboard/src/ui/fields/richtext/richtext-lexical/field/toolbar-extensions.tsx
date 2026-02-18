'use client'

import type * as React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_CRITICAL, type LexicalEditor, SELECTION_CHANGE_COMMAND } from 'lexical'

export type ToolbarExtensionItem = {
  id: string
  order?: number
  node: React.ReactNode
}

type ToolbarExtensionsContextType = {
  items: ToolbarExtensionItem[]
  register: (item: ToolbarExtensionItem) => () => void
  /**
   * The editor instance for the current selection. This matters when using nested composers.
   */
  editor: LexicalEditor
  /**
   * The root editor instance for this composer.
   */
  rootEditor: LexicalEditor
}

const ToolbarExtensionsContext = createContext<ToolbarExtensionsContextType | null>(null)

export function ToolbarExtensionsProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [rootEditor] = useLexicalComposerContext()
  const [activeEditor, setActiveEditor] = useState(rootEditor)
  const [itemsById, setItemsById] = useState<Map<string, ToolbarExtensionItem>>(() => new Map())

  useEffect(() => {
    return rootEditor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_payload, newEditor) => {
        setActiveEditor(newEditor)
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
  }, [rootEditor])

  const register = useCallback((item: ToolbarExtensionItem) => {
    setItemsById((prev) => {
      const next = new Map(prev)
      next.set(item.id, item)
      return next
    })

    return () => {
      setItemsById((prev) => {
        if (!prev.has(item.id)) return prev
        const next = new Map(prev)
        next.delete(item.id)
        return next
      })
    }
  }, [])

  const items = useMemo(() => Array.from(itemsById.values()), [itemsById])

  const value = useMemo(
    () => ({ items, register, editor: activeEditor, rootEditor }),
    [items, register, activeEditor, rootEditor]
  )

  return (
    <ToolbarExtensionsContext.Provider value={value}>{children}</ToolbarExtensionsContext.Provider>
  )
}

export function useToolbarExtensions(): ToolbarExtensionsContextType {
  const context = useContext(ToolbarExtensionsContext)
  if (context == null) {
    throw new Error('useToolbarExtensions must be used within a ToolbarExtensionsProvider')
  }
  return context
}
