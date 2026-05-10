'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { type AiPublicConfig, DEFAULT_AI_ENDPOINT } from './ai-config'

export const AiPublicConfigContext = createContext<AiPublicConfig | undefined>(undefined)

export const AiPublicConfigProvider = ({
  config,
  children,
}: {
  config?: Partial<AiPublicConfig>
  children: ReactNode
}) => {
  const resolved = useMemo<AiPublicConfig>(
    () => ({
      endpoint: config?.endpoint ?? DEFAULT_AI_ENDPOINT,
      enabled: config?.enabled,
      fetch: config?.fetch,
      headers: config?.headers,
    }),
    [config?.endpoint, config?.enabled, config?.fetch, config?.headers]
  )
  return (
    <AiPublicConfigContext.Provider value={resolved}>{children}</AiPublicConfigContext.Provider>
  )
}

export const useAiPublicConfig = (): AiPublicConfig => {
  const context = useContext(AiPublicConfigContext)
  if (context != null) {
    return context
  }
  throw new Error('useAiPublicConfig must be used within an AiPublicConfigProvider')
}

export const useOptionalAiPublicConfig = (): AiPublicConfig | undefined => {
  return useContext(AiPublicConfigContext)
}
