/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side locale resolution for the admin interface.
 *
 * Combines `@byline/i18n`'s pure `resolveInterfaceLocale` cascade with
 * the host's request-scoped signals — the `byline_admin_lng` cookie, the
 * `Accept-Language` header, and (when an admin session is present)
 * `admin_users.preferred_locale` on the authenticated actor.
 *
 * Idempotent: calling this twice in one request produces the same
 * answer. SSR and the hydrated client therefore resolve to the same
 * locale by construction — no "locale flicker" between server render
 * and client takeover.
 */

import { getRequestHeader } from '@tanstack/react-start/server'

import { AuthError, AuthErrorCodes } from '@byline/auth'
import { getAdminRequestContext } from '@byline/client/server'
import type { LocaleCode } from '@byline/i18n'
import { resolveInterfaceLocale } from '@byline/i18n'

import { bylineCore } from '../integrations/byline-core.js'
import { readAdminLocaleCookie } from './locale-cookie.js'

/**
 * Resolve the locale for the current request. Skips the
 * `admin_users.preferred_locale` tier when no admin session is present —
 * this is the right behaviour for pre-auth surfaces (sign-in page).
 *
 * Bypasses the auth resolver when `skipActorLookup` is true. Useful for
 * very early-boot surfaces where the actor lookup itself is expensive
 * or unwanted (rare; default to letting the cascade do its work).
 */
export async function resolveRequestLocale(options?: {
  skipActorLookup?: boolean
}): Promise<LocaleCode> {
  const core = bylineCore()
  const { interface: ifaceConfig } = core.config.i18n

  let preferred: string | null = null
  if (!options?.skipActorLookup) {
    preferred = await readPreferredLocaleFromActor()
  }

  return resolveInterfaceLocale({
    locales: ifaceConfig.locales,
    defaultLocale: ifaceConfig.defaultLocale,
    preferred,
    cookie: readAdminLocaleCookie(),
    acceptLanguage: readAcceptLanguage(),
  })
}

async function readPreferredLocaleFromActor(): Promise<string | null> {
  try {
    const context = await getAdminRequestContext()
    // The actor type isn't structurally typed for `preferred_locale`
    // here — read it through the admin store to keep the resolver
    // resilient to actor-shape evolution.
    const adminStore = bylineCore().adminStore
    if (adminStore == null) return null
    const actor = context.actor
    // Best-effort: the AdminAuth actor carries `id`. Reading the row
    // directly from the repo costs one query per request that resolves
    // a locale, which is fine for SSR; high-traffic paths can opt out
    // via `skipActorLookup`.
    if (actor == null || typeof actor !== 'object' || !('id' in actor)) return null
    const id = (actor as { id: unknown }).id
    if (typeof id !== 'string') return null
    const row = await adminStore.adminUsers.getById(id)
    return row?.preferred_locale ?? null
  } catch (err) {
    if (err instanceof AuthError && err.code === AuthErrorCodes.UNAUTHENTICATED) {
      return null
    }
    // Any other failure (transport, refresh) → fall through to the
    // cookie / Accept-Language tiers rather than crashing the SSR.
    return null
  }
}

function readAcceptLanguage(): string | null {
  try {
    return getRequestHeader('accept-language') ?? null
  } catch {
    return null
  }
}
