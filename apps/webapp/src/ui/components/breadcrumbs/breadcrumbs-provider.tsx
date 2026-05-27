import { createContext, type ReactNode, useContext, useState } from 'react'

import type { Breadcrumb } from './@types'

interface BreadcrumbsSettings {
  homeLabel?: string
  homePath?: string
  breadcrumbs: Breadcrumb[]
}

interface BreadcrumbsContextType {
  breadCrumbSettings: BreadcrumbsSettings
  setBreadcrumbs: (settings: BreadcrumbsSettings) => void
}

const BreadcrumbsContext = createContext<BreadcrumbsContextType | undefined>(undefined)

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [breadcrumbSettings, setBreadcrumbSettings] = useState<BreadcrumbsSettings>({
    homeLabel: 'Home',
    homePath: '/',
    breadcrumbs: [],
  })

  return (
    <BreadcrumbsContext
      value={{ breadCrumbSettings: breadcrumbSettings, setBreadcrumbs: setBreadcrumbSettings }}
    >
      {children}
    </BreadcrumbsContext>
  )
}

export function useBreadcrumbs() {
  const context = useContext(BreadcrumbsContext)
  if (!context) {
    throw new Error('useBreadcrumbs must be used within BreadcrumbsProvider')
  }
  return context
}
