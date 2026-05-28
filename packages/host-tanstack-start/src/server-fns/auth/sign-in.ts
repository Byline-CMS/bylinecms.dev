/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin sign-in server function.
 *
 * Verifies email/password against the configured `SessionProvider`, sets
 * the two-cookie session pair on success, and returns a minimal caller
 * shape (just the admin user id). Errors propagate as `AuthError`s from
 * `@byline/auth` — the UI surface renders a generic "invalid credentials"
 * message rather than distinguishing unknown-email from wrong-password
 * (the provider also equalises timing for the same reason).
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

import { getServerConfig } from '@byline/core'

import { setSessionCookies } from '../../auth/auth-cookies.js'
import { readAdminLocaleCookie } from '../../i18n/locale-cookie.js'
import { bylineCore } from '../../integrations/byline-core.js'

export interface SignInInput {
  email: string
  password: string
}

export interface SignInResult {
  userId: string
}

export const adminSignIn = createServerFn({ method: 'POST' })
  .inputValidator((input: SignInInput) => {
    if (typeof input?.email !== 'string' || input.email.length === 0) {
      throw new Error('email is required')
    }
    if (typeof input?.password !== 'string' || input.password.length === 0) {
      throw new Error('password is required')
    }
    return { email: input.email, password: input.password }
  })
  .handler(async ({ data }): Promise<SignInResult> => {
    const provider = getServerConfig().sessionProvider
    if (!provider) {
      throw new Error('no sessionProvider configured')
    }

    // TanStack Start doesn't currently expose the raw request IP in a
    // cross-runtime way; pass what we can observe and leave the ip field
    // unset. Operators who need accurate client IPs for refresh-token
    // provenance will typically run behind a reverse proxy that stamps
    // `x-forwarded-for` — revisit when Phase 5 sees real deployments.
    const userAgent = getRequestHeader('user-agent') ?? undefined
    const forwardedFor = getRequestHeader('x-forwarded-for') ?? undefined
    const ip = forwardedFor?.split(',')[0]?.trim() || undefined

    const result = await provider.signInWithPassword({
      email: data.email,
      password: data.password,
      userAgent,
      ip,
    })

    setSessionCookies(result)

    // Reconcile the byline_admin_lng cookie against the freshly-signed-in
    // user's stored preferred_locale. If the cookie carries a permitted
    // locale and it differs from what the user has stored (including the
    // "null preferred_locale" case for brand-new users), update the
    // column so the pre-auth locale choice becomes sticky across devices
    // from day one. Pure best-effort — any error short-circuits and the
    // sign-in still succeeds.
    try {
      await reconcileLocaleAfterSignIn(result.actor.id)
    } catch {
      // Swallow — locale sync is not load-bearing for the sign-in flow.
    }

    return { userId: result.actor.id }
  })

/**
 * Apply the `byline_admin_lng` cookie to `admin_users.preferred_locale`
 * when the two diverge after sign-in. No-op when:
 *
 *   - The cookie is unset (the cascade falls through to the existing
 *     column / Accept-Language / default anyway).
 *   - The cookie carries a locale outside `i18n.interface.locales`
 *     (stale value pointing at a removed locale — let the resolver
 *     fall through cleanly).
 *   - No admin store is configured (headless tooling paths).
 *   - The stored value already matches the cookie.
 */
async function reconcileLocaleAfterSignIn(adminUserId: string): Promise<void> {
  const cookieLocale = readAdminLocaleCookie()
  if (cookieLocale == null) return

  const core = bylineCore()
  const locales = core.config.i18n.interface.locales
  if (!locales.includes(cookieLocale)) return

  const adminStore = core.adminStore
  if (adminStore == null) return

  const row = await adminStore.adminUsers.getById(adminUserId)
  if (!row) return
  if (row.preferred_locale === cookieLocale) return

  await adminStore.adminUsers.setPreferredLocale(adminUserId, cookieLocale)
}
