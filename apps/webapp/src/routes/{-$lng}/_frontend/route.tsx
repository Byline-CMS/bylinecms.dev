// routes/_public/route.tsx  (pathless layout using _ prefix)

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { resolveRoutes } from '@byline/core'
import {
  RouteError,
  RouteNotFound,
} from '@byline/host-tanstack-start/admin-shell/chrome/route-error'
import { getCurrentAdminUserSoft } from '@byline/host-tanstack-start/server-fns/auth'
import { getPreviewStateFn } from '@byline/host-tanstack-start/server-fns/preview'

import { routes as bylineRoutes } from '~/routes'

import { publicCacheMiddleware } from '@/middleware/public-cache'
import { GradientBackground } from '@/modules/home/gradient-background'
import { AppBar } from '@/ui/components/app-bar'
import { ContentAdminBar } from '@/ui/components/content-admin-bar'

export const Route = createFileRoute('/{-$lng}/_frontend')({
  loader: async () => {
    // Resolve in parallel — independent reads, no need to serialise.
    const [adminUser, previewState] = await Promise.all([
      getCurrentAdminUserSoft(),
      getPreviewStateFn(),
    ])
    const { admin: adminPath } = resolveRoutes(bylineRoutes)
    return { adminUser, adminPath, preview: previewState.preview }
  },
  server: {
    middleware: [publicCacheMiddleware],
  },
  component: FrontEndLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function FrontEndLayout() {
  const { adminUser, adminPath, preview } = Route.useLoaderData()
  return (
    <>
      <GradientBackground />
      <ContentAdminBar user={adminUser} admin={adminPath} preview={preview} />
      <AppBar lng="en" />
      <main id="main-content" className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </>
  )
}
