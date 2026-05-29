// routes/_public/route.tsx  (pathless layout using _ prefix)

import { createFileRoute } from '@tanstack/react-router'

import { useLocale } from '@/i18n/hooks/use-locale-navigation'
import { publicCacheMiddleware } from '@/middleware/public-cache'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'
import { FrontendLayout } from '@/ui/layouts/frontend-layout'
import { loadFrontendLayoutData } from '@/ui/layouts/frontend-layout-loader'

export const Route = createFileRoute('/{-$lng}/_frontend')({
  loader: loadFrontendLayoutData,
  server: {
    middleware: [publicCacheMiddleware],
  },
  component: FrontEndLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function FrontEndLayout() {
  const data = Route.useLoaderData()
  const locale = useLocale()
  return <FrontendLayout {...data} locale={locale} />
}
