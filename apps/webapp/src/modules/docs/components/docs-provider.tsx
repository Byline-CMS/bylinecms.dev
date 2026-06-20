'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

interface DocsMenuContextType {
  mobile: boolean
  drawerOpen: boolean
  toggleDrawer: () => void
  closeDrawer: () => void
}

const DocsMenuContext = createContext<DocsMenuContextType | undefined>(undefined)

interface DocsProviderProps {
  children: React.ReactNode
}

export function DocsProvider({ children }: DocsProviderProps): React.JSX.Element {
  // Mobile-first: assume mobile until the media query resolves so the drawer
  // doesn't flash open before closing on small screens.
  const mobile = useMediaQuery('(max-width: 800px)') ?? true
  const [drawerOpen, setDrawerState] = useState(false)

  useEffect(() => {
    setDrawerState(!mobile)
  }, [mobile])

  const contextValue = useMemo<DocsMenuContextType>(() => {
    const toggleDrawer = (): void => {
      setDrawerState((prev) => !prev)
    }

    const closeDrawer = (): void => {
      if (mobile === true) {
        setDrawerState(false)
      }
    }

    return { mobile, drawerOpen, toggleDrawer, closeDrawer }
  }, [mobile, drawerOpen])

  return <DocsMenuContext.Provider value={contextValue}>{children}</DocsMenuContext.Provider>
}

export function useDocsMenu(): DocsMenuContextType {
  const context = useContext(DocsMenuContext)
  if (context === undefined) {
    throw new Error('useDocsMenu must be used within a DocsProvider')
  }
  return context
}
