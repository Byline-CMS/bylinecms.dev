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

import { setSessionCookies } from '@/lib/auth-cookies'

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

    return { userId: result.actor.id }
  })
