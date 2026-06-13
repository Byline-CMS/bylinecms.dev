'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { useMediaQuery } from './use-media-query.js'

interface AdminMenuContextType {
  mobile: boolean
  drawerOpen: boolean
  toggleDrawer: () => void
  closeDrawer: () => void
}
const MenuContext = createContext<AdminMenuContextType | undefined>(undefined)

interface AdminMenuProviderProps {
  children: React.ReactNode
}

/**
 * Routes that want the drawer closed by default to maximise workspace.
 * Currently collection list / detail / history / api views — a non-admin
 * editor is rarely looking at the left nav while laying out a document.
 *
 * The rule fires on *transitions* into and out of the wide region: entering
 * closes the drawer, leaving restores it open. Moving between pages inside
 * the region preserves whatever the user last did with the hamburger, so a
 * deliberate open stays open.
 */
function isWideRoute(pathname: string): boolean {
  return pathname.startsWith('/admin/collections')
}

export function AdminMenuProvider({ children }: AdminMenuProviderProps): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Mobile-first: assume mobile until the media query resolves so the drawer
  // doesn't flash open before closing on small screens.
  const mobile = useMediaQuery('(max-width: 800px)') ?? true
  const [drawerOpen, setDrawerState] = useState(false)
  // `null` = first effect run; after that we only reset drawer state on
  // narrow ↔ wide transitions so manual toggles survive same-area navigation.
  const prevIsWideRef = useRef<boolean | null>(null)

  useEffect(() => {
    const nowWide = isWideRoute(pathname)
    const prevWide = prevIsWideRef.current
    prevIsWideRef.current = nowWide

    if (mobile) {
      setDrawerState(false)
      return
    }

    if (prevWide === null || prevWide !== nowWide) {
      // Mount, or a wide ↔ narrow transition.
      setDrawerState(!nowWide)
    }
    // Same-area navigation — preserve the user's manual toggle.
  }, [pathname, mobile])

  const contextValue = useMemo(() => {
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

  return <MenuContext.Provider value={contextValue}>{children}</MenuContext.Provider>
}

function useAdminMenu(): AdminMenuContextType {
  const context = useContext(MenuContext)
  if (context === undefined) {
    throw new Error('useAdminMenu must be used within an AdminMenuProvider')
  }
  return context
}

export { useAdminMenu }
