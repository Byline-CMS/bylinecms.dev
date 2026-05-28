/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin shell layout — authenticated-only.
 *
 * `beforeLoad` resolves the current admin user (which internally verifies
 * the session cookies, refreshes transparently when needed, and throws
 * `ERR_UNAUTHENTICATED` when there is no session). On unauthenticated
 * requests we redirect to `/sign-in` with a `callbackUrl` so the user
 * lands back on the page they originally requested.
 *
 * The resolved user is returned as route context so every nested admin
 * route (and the `AdminAppBar`) can read it without an extra fetch.
 */

import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { BylineAdminServicesProvider } from '@byline/admin/services'
import { getClientConfig } from '@byline/core'
import type { LocaleCode, LocaleDefinition } from '@byline/i18n'
import { I18nProvider } from '@byline/i18n/react'
import { BylineFieldServicesProvider } from '@byline/ui/react'
import cx from 'classnames'

import { AdminAppBar } from '../admin-shell/chrome/admin-app-bar.js'
import layoutStyles from '../admin-shell/chrome/admin-layout.module.css'
import { Content } from '../admin-shell/chrome/content.js'
import { DrawerToggle } from '../admin-shell/chrome/drawer-toggle.js'
import { AdminMenuDrawer } from '../admin-shell/chrome/menu-drawer.js'
import { AdminMenuProvider } from '../admin-shell/chrome/menu-provider.js'
import { RouteError, RouteNotFound } from '../admin-shell/chrome/route-error.js'
import { RouteProgressBar } from '../admin-shell/chrome/route-progress-bar.js'
import { bylineAdminServices } from '../integrations/byline-admin-services.js'
import { BylineAiAdminProvider } from '../integrations/byline-ai.js'
import { bylineFieldServices } from '../integrations/byline-field-services.js'
import { getCurrentAdminUser } from '../server-fns/auth/index.js'
import { getActiveLocaleFn, setInterfaceLocaleFn } from '../server-fns/i18n/index.js'

interface AdminLayoutOpts {
  /** Path users are redirected to when unauthenticated. Defaults to `/sign-in`. */
  signInPath?: string
}

export function createAdminLayoutRoute(path: string, opts: AdminLayoutOpts = {}) {
  const signInPath = opts.signInPath ?? '/sign-in'

  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    beforeLoad: async ({ location }: { location: { href: string } }) => {
      try {
        const user = await getCurrentAdminUser()
        // Resolve the active interface locale once on the server so SSR
        // and the hydrated client render the same translations and
        // there's no locale flicker. Going through the server fn (rather
        // than calling `resolveRequestLocale` directly) keeps
        // `@tanstack/react-start/server` out of the client bundle — the
        // same pattern `getCurrentAdminUser` uses for `getAdminRequestContext`.
        const activeLocale = await getActiveLocaleFn()
        return { user, activeLocale }
      } catch {
        // `getCurrentAdminUser` (via `getAdminRequestContext`) throws
        // `ERR_UNAUTHENTICATED` or a related auth error when no valid
        // session is present. Redirect to sign-in with the original path
        // so we can send the user back after they authenticate.
        throw redirect({
          to: signInPath as never,
          search: { callbackUrl: location.href } as never,
        })
      }
    },
    component: function AdminLayoutComponent() {
      const { user, activeLocale } = Route.useRouteContext() as {
        user: Awaited<ReturnType<typeof getCurrentAdminUser>>
        activeLocale: LocaleCode
      }
      const { i18n } = getClientConfig()
      const localeDefinitions = buildLocaleDefinitions(
        i18n.interface.locales,
        i18n.interface.localeDefinitions
      )
      // Cookie + DB write happen in setInterfaceLocaleFn; full reload
      // re-runs beforeLoad so the provider re-renders with the new
      // bundle/locale (no in-place bundle swap needed for PR 1's scope).
      const handleSetLocale = async (next: LocaleCode) => {
        await setInterfaceLocaleFn({ data: { locale: next } })
        window.location.reload()
      }
      return (
        <I18nProvider
          bundle={i18n.translations ?? {}}
          activeLocale={activeLocale}
          defaultLocale={i18n.interface.defaultLocale}
          localeDefinitions={localeDefinitions}
          setLocale={handleSetLocale}
        >
          <BylineAdminServicesProvider services={bylineAdminServices}>
            <BylineFieldServicesProvider services={bylineFieldServices}>
              <BylineAiAdminProvider>
                <AdminMenuProvider>
                  <RouteProgressBar />
                  <AdminAppBar user={user} />
                  <main className={cx('byline-admin-layout-main', layoutStyles.main)}>
                    <DrawerToggle />
                    <AdminMenuDrawer />
                    <Content>
                      <Outlet />
                    </Content>
                  </main>
                </AdminMenuProvider>
              </BylineAiAdminProvider>
            </BylineFieldServicesProvider>
          </BylineAdminServicesProvider>
        </I18nProvider>
      )
    },
    errorComponent: RouteError,
    notFoundComponent: RouteNotFound,
  })

  return Route
}

/**
 * Build a `LocaleDefinition[]` for the language switcher. Per-code
 * resolution order:
 *
 *   1. An entry from the host's `i18n.interface.localeDefinitions`
 *      (matched by code). Wins outright — this is the path that lets a
 *      host author write `Français` instead of the lowercase
 *      `français` that CLDR's `Intl.DisplayNames` returns for romance
 *      languages.
 *   2. `Intl.DisplayNames(code).of(code)` — produces a display name in
 *      each locale's own language using CLDR's data.
 *   3. The raw code, as a last-resort fallback for exotic tags or
 *      runtimes that lack `Intl.DisplayNames`.
 */
function buildLocaleDefinitions(
  codes: readonly string[],
  configured: ReadonlyArray<{ code: string; nativeName: string }> | undefined
): LocaleDefinition[] {
  const explicit = new Map((configured ?? []).map((d) => [d.code, d.nativeName]))
  return codes.map((code) => {
    const explicitName = explicit.get(code)
    if (explicitName != null) {
      return { code, nativeName: explicitName }
    }
    let nativeName = code
    try {
      const dn = new Intl.DisplayNames([code], { type: 'language' })
      nativeName = dn.of(code) ?? code
    } catch {
      // Intl.DisplayNames is available in Node 18+ and every modern
      // browser. Defensive catch covers exotic codes or sandbox quirks.
    }
    return { code, nativeName }
  })
}
