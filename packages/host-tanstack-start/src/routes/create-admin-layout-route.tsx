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
 *
 * `i18nBridge` is a host-app-supplied wrapper that mounts the host's
 * translation primitives onto Byline's `BylineI18nProvider`. Each host
 * ships its own bridge with the same shape; the package contract here
 * is "wrap everything inside `i18nBridge`".
 */

import type { ComponentType, ReactNode } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { BylineAdminServicesProvider, BylineFieldServicesProvider } from '@byline/ui'
import cx from 'classnames'

import { AdminAppBar } from '../admin-shell/chrome/admin-app-bar.js'
import layoutStyles from '../admin-shell/chrome/admin-layout.module.css'
import { Content } from '../admin-shell/chrome/content.js'
import { DrawerToggle } from '../admin-shell/chrome/drawer-toggle.js'
import { AdminMenuDrawer } from '../admin-shell/chrome/menu-drawer.js'
import { AdminMenuProvider } from '../admin-shell/chrome/menu-provider.js'
import { RouteError, RouteNotFound } from '../admin-shell/chrome/route-error.js'
import { bylineAdminServices } from '../integrations/byline-admin-services.js'
import { bylineFieldServices } from '../integrations/byline-field-services.js'
import { getCurrentAdminUser } from '../server-fns/auth/index.js'

interface AdminLayoutOpts {
  /**
   * Host-supplied wrapper that bridges the host's translation primitives
   * onto `BylineI18nProvider`. Required so localized chrome strings (and
   * Byline UI components) resolve through the host's i18n machinery.
   */
  i18nBridge: ComponentType<{ children: ReactNode }>
  /** Path users are redirected to when unauthenticated. Defaults to `/sign-in`. */
  signInPath?: string
}

export function createAdminLayoutRoute(path: string, opts: AdminLayoutOpts) {
  const I18nBridge = opts.i18nBridge
  const signInPath = opts.signInPath ?? '/sign-in'

  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    beforeLoad: async ({ location }: { location: { href: string } }) => {
      try {
        const user = await getCurrentAdminUser()
        return { user }
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
      const { user } = Route.useRouteContext() as {
        user: Awaited<ReturnType<typeof getCurrentAdminUser>>
      }
      return (
        <I18nBridge>
          <BylineAdminServicesProvider services={bylineAdminServices}>
            <BylineFieldServicesProvider services={bylineFieldServices}>
              <AdminMenuProvider>
                <AdminAppBar user={user} />
                <main className={cx('byline-admin-layout-main', layoutStyles.main)}>
                  <DrawerToggle />
                  <AdminMenuDrawer />
                  <Content>
                    <Outlet />
                  </Content>
                </main>
              </AdminMenuProvider>
            </BylineFieldServicesProvider>
          </BylineAdminServicesProvider>
        </I18nBridge>
      )
    },
    errorComponent: RouteError,
    notFoundComponent: RouteNotFound,
  })

  return Route
}
