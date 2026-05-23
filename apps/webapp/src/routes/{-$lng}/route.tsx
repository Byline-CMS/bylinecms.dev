/**
 * Locale layout route — validates the optional {-$lng} path parameter,
 * resolves the effective locale, loads translations, and provides them
 * to all descendant routes via TranslationsProvider + router context.
 *
 * Initial cookie / Accept-Language negotiation and the redirect to the
 * locale-prefixed URL are handled by `localeRedirectMiddleware` attached
 * to this route's `server.middleware` — path-scoped, server-only, and
 * never bundled into the client graph. By the time `beforeLoad` runs
 * the URL has already been resolved to either a valid prefixed locale
 * or the default-unprefixed form.
 *
 * URL patterns:
 *   /admin/...          → default locale (en)
 *   /es/admin/...       → Spanish
 *   /fr/admin/...       → French
 *   /xyz/admin/...      → 404 (invalid locale)
 */

import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'

import { TranslationsProvider } from '@/i18n/client/translations-provider'
import { i18nConfig, type Locale } from '@/i18n/i18n-config'
import { getTranslations } from '@/i18n/translations'
import { localeRedirectMiddleware } from '@/middleware/locale-redirect'
import { RouteProgressBar } from '@/ui/components/route-progress-bar'

export const Route = createFileRoute('/{-$lng}')({
  // Constrain `lng` to the configured locale set at the matcher level so
  // TanStack Router can resolve URLs like `/es` to this route's index
  // unambiguously, rather than letting a sibling catch-all (`$path`) win.
  // Invalid locale prefixes 404 at the matcher — before any lifecycle hook.
  params: {
    parse: ({ lng }) => {
      if (lng == null) return { lng: undefined }
      if (!i18nConfig.locales.includes(lng as Locale)) {
        throw notFound()
      }
      return { lng: lng as Locale }
    },
    stringify: ({ lng }) => ({ lng: lng ?? '' }),
  },
  server: {
    middleware: [localeRedirectMiddleware],
  },
  beforeLoad: ({ params }) => ({
    locale: params.lng ?? i18nConfig.defaultLocale,
  }),
  loader: async ({ context }) => {
    const translations = await getTranslations(context.locale)
    return { translations }
  },
  component: LocaleLayout,
})

function LocaleLayout() {
  const { translations } = Route.useLoaderData()

  return (
    <TranslationsProvider translations={translations}>
      <RouteProgressBar />
      <Outlet />
    </TranslationsProvider>
  )
}
