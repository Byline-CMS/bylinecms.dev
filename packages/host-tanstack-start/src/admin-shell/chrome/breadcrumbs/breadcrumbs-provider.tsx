/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'

import type { Breadcrumb } from './@types.js'

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

/**
 * Route components build their breadcrumb trail from an inline array literal,
 * so every render submits a new array that is almost always value-identical to
 * the last one. Comparing by value lets the provider hand back the previous
 * state, which keeps the array reference — and therefore the measurement
 * effect in `Breadcrumbs` — stable across unrelated renders.
 */
function sameBreadcrumbs(a: Breadcrumb[], b: Breadcrumb[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every(
    (crumb, index) =>
      crumb.label === b[index].label &&
      crumb.href === b[index].href &&
      crumb.active === b[index].active
  )
}

function sameSettings(a: BreadcrumbsSettings, b: BreadcrumbsSettings): boolean {
  return (
    a.homeLabel === b.homeLabel &&
    a.homePath === b.homePath &&
    sameBreadcrumbs(a.breadcrumbs, b.breadcrumbs)
  )
}

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [breadcrumbSettings, setBreadcrumbSettings] = useState<BreadcrumbsSettings>({
    homeLabel: 'Home',
    homePath: '/',
    breadcrumbs: [],
  })

  // `BreadcrumbsClient` lists this setter in its effect dependencies, so it
  // has to stay referentially stable or the effect refires on every render.
  const setBreadcrumbs = useCallback((settings: BreadcrumbsSettings) => {
    setBreadcrumbSettings((previous) => (sameSettings(previous, settings) ? previous : settings))
  }, [])

  return (
    <BreadcrumbsContext value={{ breadCrumbSettings: breadcrumbSettings, setBreadcrumbs }}>
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
