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
 * URL patterns (any *routable* locale — interface ∪ content):
 *   /foo/...          → default locale (en)
 *   /fr/foo/...       → French (interface locale — chrome + content in `fr`)
 *   /es/foo/...       → Spanish (content-only locale — content renders in
 *                       `es`, chrome falls back to the default interface
 *                       locale; see `toInterfaceLocale`)
 *   /xyz/foo/...      → 404 (not a routable locale)
 */

import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'

import { TranslationsProvider } from '@/i18n/client/translations-provider'
import { i18nConfig, isRoutableLocale, toInterfaceLocale } from '@/i18n/i18n-config'
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
      if (!isRoutableLocale(lng)) {
        throw notFound()
      }
      return { lng }
    },
    stringify: ({ lng }) => ({ lng: lng ?? '' }),
  },
  server: {
    middleware: [localeRedirectMiddleware],
  },
  // `context.locale` is the URL's locale (may be a content-only locale).
  // It drives content fetching + meta downstream; chrome uses the
  // interface fallback in the loader below.
  beforeLoad: ({ params }) => ({
    locale: params.lng ?? i18nConfig.defaultLocale,
  }),
  loader: async ({ context }) => {
    // Chrome bundle keys off the interface locale — a content-only locale
    // (e.g. `fr`) has no frontend UI translations and falls back to the default.
    const translations = await getTranslations(toInterfaceLocale(context.locale))
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
