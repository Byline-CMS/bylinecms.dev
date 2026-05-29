// routes/_public/route.tsx  (pathless layout using _ prefix)

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { resolveRoutes } from '@byline/core'
import { getCurrentAdminUserSoft } from '@byline/host-tanstack-start/server-fns/auth'
import { getPreviewStateFn } from '@byline/host-tanstack-start/server-fns/preview'

import { routes as bylineRoutes } from '~/routes'

import { useLocale } from '@/i18n/hooks/use-locale-navigation'
import { publicCacheMiddleware } from '@/middleware/public-cache'
import { DocsMenuProvider } from '@/modules/docs/components/docs-menu-provider'
import { GradientBackground } from '@/modules/home/gradient-background'
import { AppBar } from '@/ui/components/app-bar'
import { BreadcrumbsProvider } from '@/ui/components/breadcrumbs/breadcrumbs-provider'
import { ContentAdminBar } from '@/ui/components/content-admin-bar'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

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
  const locale = useLocale()
  return (
    <BreadcrumbsProvider>
      <DocsMenuProvider>
        <GradientBackground />
        <ContentAdminBar user={adminUser} admin={adminPath} preview={preview} />
        <AppBar lng={locale} />
        <main id="main-content" className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </DocsMenuProvider>
    </BreadcrumbsProvider>
  )
}
