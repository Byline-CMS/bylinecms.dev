'use client'

import type * as React from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { DEFAULT_EDITOR_SETTINGS } from './default'
import type { EditorControls, EditorSettings } from './types'

// Should always produce a 20 character pseudo-random string
function generateQuickGuid(): string {
  return Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12)
}
interface ContextType {
  setControl: (name: keyof EditorControls, value: boolean) => void
  config: EditorSettings
  uuid: string
}

const Context: React.Context<ContextType> = createContext({
  setControl: (_name: keyof EditorControls, _value: boolean) => {},
  config: DEFAULT_EDITOR_SETTINGS,
  uuid: generateQuickGuid(),
})

export const EditorConfigContext = ({
  children,
  config: configFromProps,
}: {
  children: React.ReactNode
  config?: EditorSettings
}): React.JSX.Element => {
  const [config, setConfig] = useState(configFromProps ?? DEFAULT_EDITOR_SETTINGS)
  // State to store the UUID
  const [uuid] = useState(() => generateQuickGuid())

  /**
   * Toggle one interface control at runtime. Controls hide affordances
   * only — there is deliberately no equivalent for capabilities, which
   * are fixed when the editor is built.
   */
  const setControl = useCallback((control: keyof EditorControls, value: boolean) => {
    setConfig((config) => ({
      ...config,
      controls: { ...config.controls, [control]: value },
    }))
  }, [])

  const editorContext = useMemo(() => ({ setControl, config, uuid }), [setControl, config, uuid])

  return <Context.Provider value={editorContext}>{children}</Context.Provider>
}

export const useEditorConfig = (): ContextType => {
  const context = useContext(Context)
  if (context === undefined) {
    throw new Error('useEditorConfig must be used within an EditorConfigContext')
  }
  return context
}
