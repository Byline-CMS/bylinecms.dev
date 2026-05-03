'use client'

import type React from 'react'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useState } from 'react'

interface DrawerContextType {
  drawers: string[]
  addDrawer: (id: string) => void
  removeDrawer: (id: string) => void
}

const DrawerContext = createContext<DrawerContextType>({
  drawers: [],
  addDrawer: () => {},
  removeDrawer: () => {},
})

interface DrawerProviderProps {
  children: ReactNode
}

export const DrawerProvider: React.FC<DrawerProviderProps> = ({ children }) => {
  const [drawers, setDrawers] = useState<string[]>([])

  const addDrawer = useCallback((id: string) => {
    setDrawers((prev) => [...prev, id])
  }, [])

  const removeDrawer = useCallback((id: string) => {
    setDrawers((prev) => prev.filter((drawerId) => drawerId !== id))
  }, [])

  return (
    <DrawerContext.Provider value={{ drawers, addDrawer, removeDrawer }}>
      {children}
    </DrawerContext.Provider>
  )
}

export function useDrawer(): DrawerContextType {
  const context = useContext(DrawerContext)
  if (context === undefined) {
    throw new Error('useDrawer must be used within a DrawerProvider')
  }
  return context
}
