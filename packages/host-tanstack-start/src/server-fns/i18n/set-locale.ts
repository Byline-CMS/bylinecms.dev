/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Persist the admin user's interface locale preference.
 *
 * Always writes the `byline_admin_lng` cookie so the browser carries the new
 * locale to subsequent requests, including any SSR pre-resolution. When
 * an admin session is present the column on `admin_users.preferred_locale`
 * is also updated so the choice follows the user across devices.
 *
 * Locale validation is host-side: the request locale must appear in
 * `config.i18n.interface.locales` (or be `null`, which clears the
 * cookie + column and re-engages the detection cascade). Validation
 * lives here rather than in the admin module so the rule stays close
 * to the host's i18n config.
 *
 * Pre-auth path: the login page itself is translated. When the request
 * has no admin session, the cookie write still fires so the locale
 * switcher works on the sign-in surface — the DB write simply skips.
 */

import { createServerFn } from '@tanstack/react-start'

import type { AccountResponse } from '@byline/admin/admin-account'
import { setPreferredLocaleCommand } from '@byline/admin/admin-account'
import { AuthError, AuthErrorCodes } from '@byline/auth'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { clearAdminLocaleCookie, setAdminLocaleCookie } from '../../i18n/locale-cookie.js'
import { bylineCore } from '../../integrations/byline-core.js'

export interface SetInterfaceLocaleInput {
  /** BCP 47 tag, or `null` to clear the preference. */
  locale: string | null
}

export interface SetInterfaceLocaleResult {
  ok: true
  /** Echo of the persisted value. `null` means the column was cleared. */
  locale: string | null
  /**
   * Freshened admin user row when the request resolved an authenticated
   * actor. `null` on the pre-auth path (sign-in page, no admin store
   * configured). Form-shaped callers lift this into local state; the
   * top-bar `<LanguageMenu>` ignores it.
   */
  account: AccountResponse | null
}

export const setInterfaceLocaleFn = createServerFn({ method: 'POST' })
  .inputValidator((input: SetInterfaceLocaleInput) => input)
  .handler(async ({ data }): Promise<SetInterfaceLocaleResult> => {
    const core = bylineCore()
    const locales = core.config.i18n.interface.locales

    // Validate against the permitted set. `null` is always permitted —
    // it's the "use detection" signal.
    if (data.locale != null && !locales.includes(data.locale)) {
      throw new Error(
        `[setInterfaceLocaleFn] locale '${data.locale}' is not in i18n.interface.locales [${locales.join(', ')}].`
      )
    }

    // Cookie write — fires unconditionally so the pre-auth login page
    // can switch locales without an admin session.
    if (data.locale == null) {
      clearAdminLocaleCookie()
    } else {
      setAdminLocaleCookie(data.locale)
    }

    // DB write — skipped when there is no admin session. We catch the
    // unauthenticated error specifically; any other error (transport,
    // refresh failure that isn't just "no session") still bubbles up.
    const adminStore = core.adminStore
    if (adminStore == null) {
      // No admin store configured — cookie-only. Headless tooling
      // paths typically don't have one wired.
      return { ok: true as const, locale: data.locale, account: null }
    }

    try {
      const context = await getAdminRequestContext()
      const account = await setPreferredLocaleCommand(
        context,
        { locale: data.locale },
        { store: adminStore }
      )
      return { ok: true as const, locale: data.locale, account }
    } catch (err) {
      if (err instanceof AuthError && err.code === AuthErrorCodes.UNAUTHENTICATED) {
        // Expected on the pre-auth path. Cookie already written.
        return { ok: true as const, locale: data.locale, account: null }
      }
      throw err
    }
  })
