/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type ReactNode, useContext } from 'react'

import type { BylineFieldServices } from './field-services-types'

const FieldServicesContext = createContext<BylineFieldServices | null>(null)

interface BylineFieldServicesProviderProps {
  services: BylineFieldServices
  children: ReactNode
}

export const BylineFieldServicesProvider = ({
  services,
  children,
}: BylineFieldServicesProviderProps) => (
  <FieldServicesContext.Provider value={services}>{children}</FieldServicesContext.Provider>
)

export const useBylineFieldServices = (): BylineFieldServices => {
  const ctx = useContext(FieldServicesContext)
  if (!ctx) {
    throw new Error(
      '@byline/ui: BylineFieldServicesProvider missing. Wrap your admin tree with <BylineFieldServicesProvider services={…} />.'
    )
  }
  return ctx
}
