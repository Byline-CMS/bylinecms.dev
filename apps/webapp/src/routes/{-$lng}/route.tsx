/**
 * Locale layout route — validates the optional {-$lng} path parameter,
 * resolves the effective locale, loads translations, and provides them
 * to all descendant routes via TranslationsProvider + router context.
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

export const Route = createFileRoute('/{-$lng}')({
  beforeLoad: ({ params }) => {
    const lng = params.lng as string | undefined

    // If a locale segment is present but invalid, throw a 404
    if (lng != null && !i18nConfig.locales.includes(lng as Locale)) {
      throw notFound()
    }

    // Resolve the effective locale — undefined means we're on a clean URL
    // (default locale)
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
