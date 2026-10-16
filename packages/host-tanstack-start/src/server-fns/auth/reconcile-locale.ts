/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readAdminLocaleCookie } from '../../i18n/locale-cookie.js'
import { bylineCore } from '../../integrations/byline-core.js'

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
export async function reconcileLocaleAfterSignIn(adminUserId: string): Promise<void> {
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
