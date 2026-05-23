/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type ReactNode, useContext } from 'react'

import type { BylineAdminServices } from './admin-services-types.js'

export type {
  AdminServiceCall,
  BylineAdminServices,
  ChangeAccountPasswordInput,
  CreateAdminRoleInput,
  CreateAdminUserInput,
  SetAdminUserPasswordInput,
  SetRoleAbilitiesInput,
  SetUserRolesInput,
  SignInInput,
  SignInResult,
  UpdateAccountInput,
  UpdateAdminRoleInput,
  UpdateAdminUserInput,
  WhoHasAbilityInput,
} from './admin-services-types.js'

const AdminServicesContext = createContext<BylineAdminServices | null>(null)

interface BylineAdminServicesProviderProps {
  services: BylineAdminServices
  children: ReactNode
}

export const BylineAdminServicesProvider = ({
  services,
  children,
}: BylineAdminServicesProviderProps) => (
  <AdminServicesContext.Provider value={services}>{children}</AdminServicesContext.Provider>
)

export const useBylineAdminServices = (): BylineAdminServices => {
  const ctx = useContext(AdminServicesContext)
  if (!ctx) {
    throw new Error(
      '@byline/admin: BylineAdminServicesProvider missing. Wrap your admin tree with <BylineAdminServicesProvider services={…} />.'
    )
  }
  return ctx
}
