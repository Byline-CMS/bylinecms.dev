/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-side ability helpers for the admin shell.
 *
 * These hooks read the current admin user's ability set off the admin
 * route's TanStack Router context — which `route.tsx` populates in
 * `beforeLoad` via `getCurrentAdminUser()`. No separate React Context
 * provider is required because the route context already plays that
 * role.
 *
 * **Cosmetic UI only.** A hidden menu item, disabled button, or
 * un-rendered children block is an affordance, never a security
 * boundary. Every server-side path is independently gated by
 * `assertActorCanPerform` (document collections) or `assertAdminActor`
 * (admin user / role / permission management). Callers can construct
 * the matching ability key by hand or — preferred — import the
 * `ADMIN_*_ABILITIES` constants from the relevant
 * `@byline/admin/admin-*` subpath so a rename surfaces as a type error
 * rather than a silent miss.
 *
 * Super-admin bypass mirrors the server: every `useAbility` call
 * returns `true` when `is_super_admin` is set.
 *
 * Snapshot semantics: the ability set is the snapshot from the last
 * `beforeLoad` of the admin route, refreshed on navigation. A grant
 * revoked mid-session won't disappear from the UI until the next
 * navigation — fine for cosmetic cues since the server still rejects
 * the underlying action.
 */

import type React from 'react'
import { useRouteContext } from '@tanstack/react-router'

/** Route id of the admin shell — the layout route that owns `user` on context. */
const ADMIN_ROUTE_ID = '/(byline)/admin' as const

/**
 * `true` when the current admin holds the given ability (or is a
 * super-admin). Cosmetic — see file-level docstring.
 */
export function useAbility(ability: string): boolean {
  const { user } = useRouteContext({ from: ADMIN_ROUTE_ID })
  if (user.is_super_admin) return true
  return user.abilities.includes(ability)
}

/**
 * Bundle of ability checks for situations where a component needs more
 * than one verb (e.g. the menu drawer asks about three keys at once).
 * Avoids calling `useAbility` repeatedly when a single context read is
 * sufficient.
 */
export function useAbilities(): {
  has: (ability: string) => boolean
  hasAny: (abilities: readonly string[]) => boolean
  isSuperAdmin: boolean
} {
  const { user } = useRouteContext({ from: ADMIN_ROUTE_ID })
  const has = (ability: string): boolean => user.is_super_admin || user.abilities.includes(ability)
  const hasAny = (abilities: readonly string[]): boolean =>
    user.is_super_admin || abilities.some((key) => user.abilities.includes(key))
  return { has, hasAny, isSuperAdmin: user.is_super_admin }
}

/**
 * JSX wrapper. Renders `children` only when the current admin holds
 * the given ability. Cosmetic — see file-level docstring.
 *
 * ```tsx
 * <RequireAbility ability={ADMIN_USERS_ABILITIES.create}>
 *   <Button>New admin user</Button>
 * </RequireAbility>
 * ```
 */
export function RequireAbility({
  ability,
  children,
}: {
  ability: string
  children: React.ReactNode
}): React.ReactNode {
  return useAbility(ability) ? children : null
}
