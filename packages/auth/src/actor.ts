/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Actor primitives.
 *
 * Two realms are modelled from day one, even though only `AdminAuth` is
 * fleshed out in Phase 0:
 *
 *   - `AdminAuth` — the identity of a signed-in Byline admin (CMS staff,
 *     editors, super-admins). Carries a flat set of ability strings
 *     resolved from the role graph.
 *   - `UserAuth`  — reserved for end-user / app-side identity (public
 *     readers with entitlements, member-only access, per-user drafts).
 *     Stubbed out in Phase 0 so every signature that must accommodate
 *     "either realm or neither" can reference it already; filled in when
 *     a concrete end-user feature arrives.
 *
 * The `Actor` union (`AdminAuth | UserAuth | null`) is the canonical shape
 * carried on `RequestContext`. A `null` actor represents an
 * unauthenticated request — only permitted on public read paths
 * (`readMode === 'published'`) once service-layer enforcement lands
 * (the outstanding item in AUTHN-AUTHZ-ANALYSIS.md).
 *
 * Ability keys are flat dotted strings (e.g. `collections.pages.publish`,
 * `media.manage`). See AUTHN-AUTHZ-ANALYSIS.md §4 for the rationale and
 * §1 (Phase 1) for the registry that mints them.
 */

import { ERR_FORBIDDEN } from './errors.js'

/**
 * Admin-realm identity. Constructed by the session provider's
 * `resolveActor()` method, which joins roles → permissions into the
 * flat ability set.
 *
 * `isSuperAdmin` short-circuits every ability check. It mirrors the
 * `is_super_admin` flag on the `admin_users` row (see Phase 2 schema).
 */
export class AdminAuth {
  public readonly id: string
  public readonly abilities: ReadonlySet<string>
  public readonly isSuperAdmin: boolean

  constructor(params: {
    id: string
    abilities: Iterable<string>
    isSuperAdmin?: boolean
  }) {
    this.id = params.id
    this.abilities = new Set(params.abilities)
    this.isSuperAdmin = params.isSuperAdmin ?? false
  }

  /** Non-throwing check. Super-admins always return `true`. */
  hasAbility(ability: string): boolean {
    if (this.isSuperAdmin) return true
    return this.abilities.has(ability)
  }

  /**
   * Throwing check. Throws `ERR_FORBIDDEN` when the actor lacks the
   * ability. Super-admins bypass. Primary enforcement call site once
   * service-layer enforcement (`document-lifecycle` / `IDocumentQueries`)
   * is wired in.
   */
  assertAbility(ability: string, message?: string): void {
    if (this.isSuperAdmin) return
    if (!this.abilities.has(ability)) {
      throw ERR_FORBIDDEN({
        message: message ?? `missing required ability: ${ability}`,
      })
    }
  }

  /**
   * Throwing check for a set of abilities (AND semantics — every listed
   * ability must be held). Super-admins bypass.
   */
  assertAbilities(abilities: readonly string[], messageFor?: (ability: string) => string): void {
    if (this.isSuperAdmin) return
    for (const ability of abilities) {
      if (!this.abilities.has(ability)) {
        throw ERR_FORBIDDEN({
          message: messageFor?.(ability) ?? `missing required ability: ${ability}`,
        })
      }
    }
  }
}

/**
 * End-user / app-side identity. Stubbed in Phase 0 — the class exists so
 * `Actor` can discriminate between realms without later breaking
 * signatures, but the ability surface is deliberately minimal.
 *
 * Fleshed out when an end-user sign-in surface is actually needed. Until
 * then, assume no call path constructs a `UserAuth` instance in practice.
 */
export class UserAuth {
  public readonly id: string
  public readonly abilities: ReadonlySet<string>

  constructor(params: { id: string; abilities?: Iterable<string> }) {
    this.id = params.id
    this.abilities = new Set(params.abilities ?? [])
  }

  hasAbility(ability: string): boolean {
    return this.abilities.has(ability)
  }

  assertAbility(ability: string, message?: string): void {
    if (!this.abilities.has(ability)) {
      throw ERR_FORBIDDEN({
        message: message ?? `missing required ability: ${ability}`,
      })
    }
  }
}

/**
 * Canonical actor shape carried on `RequestContext`. `null` represents an
 * unauthenticated request — permitted only on public read paths once
 * service-layer enforcement is in place.
 */
export type Actor = AdminAuth | UserAuth | null

/** Narrow an `Actor` to the admin realm. */
export function isAdminAuth(actor: Actor): actor is AdminAuth {
  return actor instanceof AdminAuth
}

/** Narrow an `Actor` to the end-user realm. */
export function isUserAuth(actor: Actor): actor is UserAuth {
  return actor instanceof UserAuth
}
