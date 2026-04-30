/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Framework-neutral function contracts that admin UI components in
 * `@byline/ui` need from the host application. The host wires concrete
 * implementations via `BylineAdminServicesProvider` — typically thin
 * adapters around TanStack Start server functions, Next.js server
 * actions, or any other RPC-style transport.
 *
 * The call shape `(args: { data: TInput }) => Promise<TOutput>` mirrors
 * TanStack Start's `createServerFn().handler()` calling convention so a
 * webapp host can pass its server fns through as-is. Other transports
 * just need a tiny adapter.
 *
 * Scope: Phase 2.1 covers the framework-neutral admin UI components
 * only — the 15 forms, modals, and inner widgets that don't touch
 * TanStack Router. Page containers (list/edit/delete pages) keep using
 * server fns directly today and move into `@byline/host-tanstack-start`
 * in Phase 3 along with the route factories.
 */

import type {
  AccountResponse,
  ChangeAccountPasswordRequest,
  UpdateAccountRequest,
} from '@byline/admin/admin-account'
import type {
  SetRoleAbilitiesResponse,
  WhoHasAbilityResponse,
} from '@byline/admin/admin-permissions'
import type { AdminRoleResponse, UserRolesResponse } from '@byline/admin/admin-roles'
import type { AdminUserResponse } from '@byline/admin/admin-users'

/**
 * The TanStack Start `createServerFn(...).handler(...)` calling shape:
 * `fn({ data: input }) → Promise<output>`. Hosts using a different
 * transport supply small adapters that match this shape.
 */
export type AdminServiceCall<TInput, TOutput> = (args: { data: TInput }) => Promise<TOutput>

// --- Auth -----------------------------------------------------------------

export interface SignInInput {
  email: string
  password: string
}

/**
 * The admin UI's sign-in form does not consume the `SignInResult`
 * payload directly — on success it navigates via `window.location`. The
 * shape is left as `unknown` here so each host's session provider can
 * supply whatever envelope it produces without forcing a public type.
 */
export type SignInResult = unknown

// --- Account self-service -------------------------------------------------

/** Same shape as `UpdateAccountRequest` from `@byline/admin/admin-account`. */
export type UpdateAccountInput = UpdateAccountRequest

/** Same shape as `ChangeAccountPasswordRequest` from `@byline/admin/admin-account`. */
export type ChangeAccountPasswordInput = ChangeAccountPasswordRequest

// --- Admin users ----------------------------------------------------------

export interface CreateAdminUserInput {
  email: string
  password: string
  given_name?: string | null
  family_name?: string | null
  username?: string | null
  is_super_admin: boolean
  is_enabled: boolean
  is_email_verified: boolean
}

export interface UpdateAdminUserInput {
  id: string
  vid: number
  patch: {
    email?: string
    given_name?: string | null
    family_name?: string | null
    username?: string | null
    is_super_admin?: boolean
    is_enabled?: boolean
    is_email_verified?: boolean
  }
}

export interface SetAdminUserPasswordInput {
  id: string
  vid: number
  password: string
}

export interface SetUserRolesInput {
  userId: string
  roleIds: string[]
}

// --- Admin roles ----------------------------------------------------------

export interface CreateAdminRoleInput {
  name: string
  machine_name: string
  description: string | null
}

export interface UpdateAdminRoleInput {
  id: string
  vid: number
  patch: {
    name?: string
    description?: string | null
  }
}

// --- Permissions ----------------------------------------------------------

export interface SetRoleAbilitiesInput {
  id: string
  abilities: string[]
}

export interface WhoHasAbilityInput {
  ability: string
}

// --- Service contract -----------------------------------------------------

export interface BylineAdminServices {
  // Auth
  adminSignIn: AdminServiceCall<SignInInput, SignInResult>

  // Account self-service
  updateAccount: AdminServiceCall<UpdateAccountInput, AccountResponse>
  changeAccountPassword: AdminServiceCall<ChangeAccountPasswordInput, AccountResponse>

  // Admin user writes (page-container reads stay in the host for now)
  createAdminUser: AdminServiceCall<CreateAdminUserInput, AdminUserResponse>
  updateAdminUser: AdminServiceCall<UpdateAdminUserInput, AdminUserResponse>
  setAdminUserPassword: AdminServiceCall<SetAdminUserPasswordInput, AdminUserResponse>
  setUserRoles: AdminServiceCall<SetUserRolesInput, UserRolesResponse>

  // Admin role writes
  createAdminRole: AdminServiceCall<CreateAdminRoleInput, AdminRoleResponse>
  updateAdminRole: AdminServiceCall<UpdateAdminRoleInput, AdminRoleResponse>

  // Permissions
  setRoleAbilities: AdminServiceCall<SetRoleAbilitiesInput, SetRoleAbilitiesResponse>
  whoHasAbility: AdminServiceCall<WhoHasAbilityInput, WhoHasAbilityResponse>

  /**
   * Diff helper. Loads a specific historical version of a document so
   * the diff modal can compare it against the current version. Returns
   * the same shape as the regular document loader — the diff modal
   * consumes only `doc.fields` (or strips known meta keys when an
   * older flat-shape doc is encountered).
   *
   * Positional-args shape rather than `{ data }` because this helper
   * predates the contract and is consumed only by `DiffModal`. Hosts
   * adapt their server fn into this call signature.
   */
  getCollectionDocumentVersion: (
    collection: string,
    documentId: string,
    versionId: string,
    locale: string | undefined
  ) => Promise<Record<string, unknown>>
}
