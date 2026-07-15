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

import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { applyStoredTheme } from '@byline/admin/admin-account/components/theme'
import { BylineFieldServicesProvider } from '@byline/admin/react'
import { BylineAdminServicesProvider } from '@byline/admin/services'
import { getClientConfig } from '@byline/core'
import type { LocaleCode } from '@byline/i18n'
import { I18nProvider } from '@byline/i18n/react'
import cx from 'classnames'

import { AdminAppBar } from '../admin-shell/chrome/admin-app-bar.js'
import layoutStyles from '../admin-shell/chrome/admin-layout.module.css'
import { AdminMenuDrawer } from '../admin-shell/chrome/admin-menu-drawer.jsx'
import { AdminMenuProvider } from '../admin-shell/chrome/admin-menu-provider.jsx'
import { Content } from '../admin-shell/chrome/content.js'
import { RouteError, RouteNotFound } from '../admin-shell/chrome/route-error.js'
import { RouteProgressBar } from '../admin-shell/chrome/route-progress-bar.js'
import { buildLocaleDefinitions } from '../i18n/locale-definitions.js'
import { bylineAdminServices } from '../integrations/byline-admin-services.js'
import { BylineAiAdminProvider } from '../integrations/byline-ai.js'
import { bylineFieldServices } from '../integrations/byline-field-services.js'
import { getCurrentAdminUser } from '../server-fns/auth/index.js'
import { getActiveLocaleFn, setInterfaceLocaleFn } from '../server-fns/i18n/index.js'
import { getSignInRoutePath } from './sign-in-path.js'

interface AdminLayoutOpts {
  /** @deprecated Configure `routes.signIn`; an override must resolve to the same path. */
  signInPath?: string
}

export function createAdminLayoutRoute(path: string, opts: AdminLayoutOpts = {}) {
  const Route: any = createFileRoute(path as never)({
    beforeLoad: async ({ location }: { location: { href: string } }) => {
      const signInPath = getSignInRoutePath(opts.signInPath)
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
      // Re-assert the admin user's stored theme when the shell mounts.
      // Byline shares the host's theme contract, but a host theme provider
      // can clobber the stored choice on navigation; this makes the admin
      // area self-correcting regardless of how the host manages theme.
      useEffect(() => {
        applyStoredTheme()
      }, [])
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
