/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure locale-resolution cascade. Called once per request — server-side
 * by the host adapter during request-context resolution; client-side
 * during admin shell mount.
 *
 * Cascade (first non-null wins):
 *   1. `preferred` — the authenticated admin user's stored preference
 *      (`admin_users.preferred_locale`). Always wins when set.
 *   2. `cookie`    — the `byline_admin_lng` cookie from the last language switch.
 *   3. `acceptLanguage` — standards-compliant negotiation against the
 *      permitted locale set via `@formatjs/intl-localematcher`.
 *   4. `defaultLocale` — last-resort fallback.
 *
 * Every step validates the candidate against the permitted `locales`
 * set, so a stale cookie pointing at a removed locale falls through
 * cleanly rather than producing a locale the bundle can't satisfy.
 */

import { match } from '@formatjs/intl-localematcher'
import Negotiator from 'negotiator'

import type { LocaleCode } from './types.js'

export interface ResolveInterfaceLocaleOptions {
  /** Permitted locale set — from `i18n.interface.locales`. */
  locales: readonly LocaleCode[]
  /** Last-resort fallback — from `i18n.interface.defaultLocale`. */
  defaultLocale: LocaleCode
  /** `admin_users.preferred_locale` for the authenticated request, if any. */
  preferred?: LocaleCode | null
  /** Value of the `byline_admin_lng` cookie. */
  cookie?: string | null
  /** Raw `Accept-Language` request header. */
  acceptLanguage?: string | null
}

export function resolveInterfaceLocale(options: ResolveInterfaceLocaleOptions): LocaleCode {
  const { locales, defaultLocale, preferred, cookie, acceptLanguage } = options

  // Tier 1 — admin user preference.
  if (preferred != null && locales.includes(preferred)) {
    return preferred
  }

  // Tier 2 — cookie.
  if (cookie != null && locales.includes(cookie)) {
    return cookie
  }

  // Tier 3 — Accept-Language negotiation.
  if (acceptLanguage != null && acceptLanguage.length > 0) {
    const matched = negotiateAcceptLanguage(acceptLanguage, locales, defaultLocale)
    if (matched != null) return matched
  }

  // Tier 4 — default.
  return defaultLocale
}

function negotiateAcceptLanguage(
  header: string,
  locales: readonly LocaleCode[],
  defaultLocale: LocaleCode
): LocaleCode | null {
  try {
    const negotiator = new Negotiator({
      headers: { 'accept-language': header },
    })
    const requested = negotiator.languages()
    if (requested.length === 0) return null
    const matched = match(requested, locales as LocaleCode[], defaultLocale)
    return locales.includes(matched) ? matched : null
  } catch {
    return null
  }
}
