/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Host-side adapter that binds the webapp's TanStack Start server functions
 * to the framework-neutral `BylineAdminServices` contract consumed by
 * `@byline/ui` admin components.
 *
 * Wired into the admin route once via `<BylineAdminServicesProvider>`. A
 * future Next.js host would ship its own adapter file (server-actions in
 * place of server fns) and Provider; the `@byline/ui` surface is unchanged.
 *
 * Contract scope: only the framework-neutral admin UI components consume
 * this — sign-in, account self-service, admin-user/role write forms, the
 * permissions inspector, role-permissions editor, and the diff modal.
 * Page-container reads (list/edit) stay on direct server-fn imports
 * inside the host's deferred router-coupled containers.
 */

import type { BylineAdminServices } from '@byline/ui'

import { changeAccountPassword, updateAccount } from '@/modules/admin/admin-account'
import { setRoleAbilities, whoHasAbility } from '@/modules/admin/admin-permissions'
import { createAdminRole, updateAdminRole } from '@/modules/admin/admin-roles'
import {
  createAdminUser,
  setAdminUserPassword,
  setUserRoles,
  updateAdminUser,
} from '@/modules/admin/admin-users'
import { adminSignIn } from '@/modules/admin/auth'
import { getCollectionDocumentVersion as serverGetCollectionDocumentVersion } from '@/modules/admin/collections/server/get'

/**
 * Diff helper adapter — the contract uses positional args; the underlying
 * server-fn helper expects the same shape, so this is a one-line passthrough
 * that maps `null` to a default-loader-friendly `Record<string, unknown>`
 * fallback (the diff modal handles a `null` doc gracefully via its own
 * loading/error states, but the contract types it as non-null because the
 * happy-path always returns an object).
 */
const getCollectionDocumentVersion: BylineAdminServices['getCollectionDocumentVersion'] = async (
  collection,
  documentId,
  versionId,
  locale
) => {
  const result = await serverGetCollectionDocumentVersion(collection, documentId, versionId, locale)
  if (result == null) {
    throw new Error(
      `Document version not found: collection=${collection} document=${documentId} version=${versionId}`
    )
  }
  return result as Record<string, unknown>
}

export const bylineAdminServices: BylineAdminServices = {
  // Auth
  adminSignIn,

  // Account self-service
  updateAccount,
  changeAccountPassword,

  // Admin user writes
  createAdminUser,
  updateAdminUser,
  setAdminUserPassword,
  setUserRoles,

  // Admin role writes
  createAdminRole,
  updateAdminRole,

  // Permissions
  setRoleAbilities,
  whoHasAbility,

  // Diff helper
  getCollectionDocumentVersion,
}
