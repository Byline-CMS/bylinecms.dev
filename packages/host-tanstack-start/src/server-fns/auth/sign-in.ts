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
import { getRequest, getRequestHeader } from '@tanstack/react-start/server'

import type { SignInAdmission } from '@byline/auth'
import { setSessionCookies } from '@byline/client/server'
import { getServerConfig } from '@byline/core'
import { passwordSignInSchema } from '@byline/core/validation'

import { readAdminLocaleCookie } from '../../i18n/locale-cookie.js'
import { bylineCore } from '../../integrations/byline-core.js'
import { normalizeClientIp } from '../../integrations/client-ip.js'
import { wasSignInBodyChecked } from '../../integrations/sign-in-body.js'

export interface SignInInput {
  email: string
  password: string
}

export interface SignInResult {
  userId: string
}

export const adminSignIn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const parsed = passwordSignInSchema.safeParse(input)
    if (!parsed.success) throw new Response('Invalid sign-in input', { status: 400 })
    return parsed.data
  })
  .handler(async ({ data }): Promise<SignInResult> => {
    const provider = getServerConfig().sessionProvider
    if (!provider) {
      throw new Error('no sessionProvider configured')
    }

    const request = getRequest()
    const protection = getServerConfig().passwordSignIn
    if (!wasSignInBodyChecked(request)) {
      throw new Response('Password sign-in request middleware is not configured', { status: 503 })
    }
    if (!protection) {
      throw new Response('Password sign-in protection is not configured', { status: 503 })
    }
    const userAgent = getRequestHeader('user-agent')?.slice(0, 512)
    let ip: string | null
    try {
      ip = normalizeClientIp(await protection.resolveClientIp(request))
    } catch {
      throw new Response('Client address unavailable', { status: 503 })
    }
    if (!ip) throw new Response('Client address unavailable', { status: 503 })
    const tooMany = (seconds: number) =>
      new Response('Too many sign-in attempts', {
        status: 429,
        headers: { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' },
      })
    let release: (() => void) | null
    try {
      release = await protection.limiter.acquire()
    } catch {
      throw new Response('Sign-in temporarily unavailable', { status: 503 })
    }
    if (!release) throw tooMany(1)
    const recordResult = (outcome: 'success' | 'failure') => {
      try {
        protection.limiter.recordResult?.({ email: data.email, ip }, outcome)
      } catch {
        /* Telemetry cannot change authentication outcomes. */
      }
    }
    const result = await (async () => {
      try {
        let admission: SignInAdmission
        try {
          admission = await protection.limiter.consume({ email: data.email, ip })
        } catch {
          throw new Response('Sign-in temporarily unavailable', { status: 503 })
        }
        if (!admission.allowed) throw tooMany(admission.retryAfterSeconds)
        try {
          const result = await provider.signInWithPassword({
            email: data.email,
            password: data.password,
            userAgent,
            ip,
          })
          recordResult('success')
          return result
        } catch (error) {
          recordResult('failure')
          throw error
        }
      } finally {
        release()
      }
    })()

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
 *   - The cookie carries a locale outside `i18n.admin.locales`
 *     (stale value pointing at a removed locale — let the resolver
 *     fall through cleanly).
 *   - No admin store is configured (headless tooling paths).
 *   - The stored value already matches the cookie.
 */
async function reconcileLocaleAfterSignIn(adminUserId: string): Promise<void> {
  const cookieLocale = readAdminLocaleCookie()
  if (cookieLocale == null) return

  const core = bylineCore()
  const locales = core.config.i18n.admin.locales
  if (!locales.includes(cookieLocale)) return

  const adminStore = core.adminStore
  if (adminStore == null) return

  const row = await adminStore.adminUsers.getById(adminUserId)
  if (!row) return
  if (row.preferred_locale === cookieLocale) return

  await adminStore.adminUsers.setPreferredLocale(adminUserId, cookieLocale)
}
