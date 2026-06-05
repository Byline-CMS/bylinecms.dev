// routes/_public/route.tsx  (pathless layout using _ prefix)

import { createFileRoute } from '@tanstack/react-router'

import { useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { publicCacheMiddleware } from '@/middleware/public-cache'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'
import { FrontendLayout } from '@/ui/layouts/frontend-layout'
import { loadFrontendLayoutData } from '@/ui/layouts/frontend-layout-loader'

export const Route = createFileRoute('/$lng/_frontend')({
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
  // Chrome renders in the interface locale — on a content-only URL (`/fr`)
  // the nav, footer, and menu links revert to the visitor's interface
  // locale rather than carrying the `/fr` prefix.
  const locale = useInterfaceLocale()
  return <FrontendLayout {...data} locale={locale} />
}
