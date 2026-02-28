/**
 * Locale layout route — validates the optional {-$lng} path parameter,
 * resolves the effective locale, loads translations, and provides them
 * to all descendant routes via TranslationsProvider + router context.
 *
 * With SSR enabled, the `beforeLoad` hook runs on the server for the
 * initial request. When no locale segment is in the URL it calls
 * `detectLocaleFn` to read the cookie / Accept-Language header and, if
 * the detected locale is not the default, **redirects** to the
 * locale-prefixed path before any HTML is sent to the client.
 *
 * URL patterns:
 *   /admin/...          → default locale (en)
 *   /es/admin/...       → Spanish
 *   /fr/admin/...       → French
 *   /xyz/admin/...      → 404 (invalid locale)
 */

import { createFileRoute, notFound, Outlet, redirect } from '@tanstack/react-router'

import { TranslationsProvider } from '@/i18n/client/translations-provider'
import { i18nConfig, type Locale } from '@/i18n/i18n-config'
import { detectLocaleFn } from '@/i18n/set-language-fn'
import { getTranslations } from '@/i18n/translations'

export const Route = createFileRoute('/{-$lng}')({
  beforeLoad: async ({ params, location }) => {
    const lng = params.lng as string | undefined

    // -----------------------------------------------------------------------
    // Guard: skip locale detection / redirect for server-handler API routes.
    //
    // Routes that define `server.handlers` (e.g. the upload endpoint) are
    // processed as raw HTTP handlers and do NOT execute the React Router
    // lifecycle (beforeLoad / loader / component).  This early-exit is a
    // defensive measure in case a future TanStack version changes that
    // behaviour — it ensures API responses are never redirected or delayed
    // by locale negotiation.
    // -----------------------------------------------------------------------
    if (location.pathname.includes('/admin/api/')) {
      return { locale: (lng as Locale) ?? i18nConfig.defaultLocale }
    }

    // If a locale segment is present but invalid, throw a 404
    if (lng != null && !i18nConfig.locales.includes(lng as Locale)) {
      throw notFound()
    }

    // If no locale in the URL, detect from cookie / Accept-Language on the server
    if (lng == null) {
      const { locale: detected } = await detectLocaleFn()

      // If the detected locale is not the default, redirect to the
      // locale-prefixed URL so the user gets their preferred language.
      if (detected !== i18nConfig.defaultLocale) {
        throw redirect({
          href: `/${detected}${location.pathname}`,
          replace: true,
          statusCode: 302,
        })
      }
    }

    // Resolve the effective locale
    const locale = (lng as Locale) ?? i18nConfig.defaultLocale

    return { locale }
  },
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
      <Outlet />
    </TranslationsProvider>
  )
}
