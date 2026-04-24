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

import { getCurrentAdminUser } from '@/modules/admin/auth'
import { Content } from '@/ui/admin/content'
import { AdminMenuDrawer } from '@/ui/admin/menu-drawer'
import { AdminMenuProvider } from '@/ui/admin/menu-provider'
import { AdminAppBar } from '@/ui/components/admin-app-bar'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

export const Route = createFileRoute('/{-$lng}/(byline)/admin')({
  beforeLoad: async ({ location }) => {
    try {
      const user = await getCurrentAdminUser()
      return { user }
    } catch {
      // `getCurrentAdminUser` (via `getAdminRequestContext`) throws
      // `ERR_UNAUTHENTICATED` or a related auth error when no valid
      // session is present. Redirect to sign-in with the original path
      // so we can send the user back after they authenticate.
      throw redirect({
        to: '/{-$lng}/sign-in',
        search: { callbackUrl: location.href },
      })
    }
  },
  component: AdminLayoutComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function AdminLayoutComponent() {
  const { user } = Route.useRouteContext()
  return (
    <AdminMenuProvider>
      <AdminAppBar user={user} />
      <main className="flex min-h-screen w-full max-w-full pt-[45px]">
        <AdminMenuDrawer />
        <Content>
          <Outlet />
        </Content>
      </main>
    </AdminMenuProvider>
  )
}
