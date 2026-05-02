// routes/_public/route.tsx  (pathless layout using _ prefix)

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { getClientConfig, resolveRoutes } from '@byline/core'
import {
  RouteError,
  RouteNotFound,
} from '@byline/host-tanstack-start/admin-shell/chrome/route-error'
import { getCurrentAdminUserSoft } from '@byline/host-tanstack-start/server-fns/auth'

import { GradientBackground } from '@/modules/home/gradient-background'
import { AppBar } from '@/ui/components/app-bar'
import { ContentAdminBar } from '@/ui/components/content-admin-bar'

export const Route = createFileRoute('/{-$lng}/_public')({
  loader: async () => {
    const adminUser = await getCurrentAdminUserSoft()
    const { admin: adminPath } = resolveRoutes(getClientConfig().routes)
    return { adminUser, adminPath }
  },
  component: PublicLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function PublicLayout() {
  const { adminUser, adminPath } = Route.useLoaderData()
  return (
    <>
      <GradientBackground />
      <ContentAdminBar user={adminUser} admin={adminPath} />
      <AppBar lng="en" />
      <main id="main-content" className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </>
  )
}
