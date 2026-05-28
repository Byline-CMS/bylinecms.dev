/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Cookie helpers for the admin interface locale preference.
 *
 * The cookie name is `byline_admin_lng` — follows the `byline_*` prefix
 * convention shared with the other admin cookies (`byline_access_token`,
 * `byline_refresh_token`, `byline_preview`). Deliberately distinct from
 * any host-side front-end-site i18n cookie (the example webapp uses
 * `lng` for its public-site switcher). The two systems are independent:
 * an editor in a Spanish-language admin chrome routinely edits English /
 * French / German content, and the host's public site may carry its own
 * locale switcher in its own cookie. Sharing one cookie across both
 * would cause cross-talk.
 *
 * Cookie attributes:
 *   - `httpOnly: false` — the client-side `<LanguageMenu>` reads the
 *     cookie to render the active row indicator; setting it httpOnly
 *     would force a server roundtrip on every page load just to know
 *     which locale the user chose.
 *   - `sameSite: 'lax'`
 *   - `secure: true` in production — https-only.
 *   - `path: '/'`
 *   - `maxAge: 365 days` — language preference is a long-lived choice.
 */

import { getCookie, setCookie } from '@tanstack/react-start/server'

export const ADMIN_LOCALE_COOKIE = 'byline_admin_lng'
const ADMIN_LOCALE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 // 365 days

const IS_PROD = process.env.NODE_ENV === 'production'

/** Read the current admin locale cookie, if any. */
export function readAdminLocaleCookie(): string | null {
  return getCookie(ADMIN_LOCALE_COOKIE) ?? null
}

/**
 * Write the admin locale cookie. Caller is expected to have validated
 * `locale` against the permitted `i18n.interface.locales` set first.
 */
export function setAdminLocaleCookie(locale: string): void {
  setCookie(ADMIN_LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: ADMIN_LOCALE_MAX_AGE_SECONDS,
  })
}

/** Clear the cookie — used when a user opts back into browser-default detection. */
export function clearAdminLocaleCookie(): void {
  setCookie(ADMIN_LOCALE_COOKIE, '', {
    httpOnly: false,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  })
}
