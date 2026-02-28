'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

// DocContext
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

// DocProvider
export function AdminMenuProvider({ children }: AdminMenuProviderProps): React.JSX.Element {
  // Note: assume mobile first! - it looks much better on mobile to default to mobile
  // true and therefore drawer closed, than to see it briefly open before closing
  const mobile = useMediaQuery('(max-width: 800px)') ?? true
  const [drawerOpen, setDrawerState] = useState(mobile === false)

  // Update drawer state based on entering/exiting mobile
  useEffect(() => {
    setDrawerState(mobile === false)
  }, [mobile])

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

// Hook helper useAdminMenu
function useAdminMenu(): AdminMenuContextType {
  const context = useContext(MenuContext)
  if (context === undefined) {
    throw new Error('useAdminMenu must be used within a DocProvider')
  }
  return context
}

export { useAdminMenu }
