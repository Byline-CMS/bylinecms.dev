'use client'

import { createContext, type ReactNode, useContext } from 'react'

import type { AiPublicConfig } from './ai-config'

export const AiPublicConfigContext = createContext<AiPublicConfig | undefined>(undefined)

export const AiPublicConfigProvider = ({
  config,
  children,
}: {
  config: AiPublicConfig
  children: ReactNode
}) => {
  return <AiPublicConfigContext.Provider value={config}>{children}</AiPublicConfigContext.Provider>
}

export const useAiPublicConfig = () => {
  const context = useContext(AiPublicConfigContext)
  if (context != null) {
    return context
  }
  throw new Error('useAiPublicConfig must be used within a AiPublicConfigProvider')
}
