/**
 * Locale layout route — validates the REQUIRED `$lng` path parameter,
 * resolves the effective locale, loads translations, and provides them
 * to all descendant routes via TranslationsProvider + router context.
 *
 * Every internal frontend URL carries a locale segment (incl. `en`): the
 * router's `rewrite.input` (`src/i18n/locale-rewrite.ts`) prepends the
 * default locale to bare paths before the matcher runs, and `rewrite.output`
 * strips it again so the address bar stays clean for the default locale. By
 * the time `parse` runs, `lng` is therefore always present.
 *
 * Cookie / Accept-Language *negotiation* (redirect a first-time visitor to
 * `/fr/…`) and canonicalisation of an externally-typed `/en/…` live in the
 * server entry (`src/server.ts`), which sees the original un-rewritten
 * request — not here, since rewrites run before route middleware.
 *
 * URL patterns (any *routable* locale — interface ∪ content):
 *   /foo/...   (internally /en/foo/...) → default locale (en)
 *   /fr/foo/...                          → French (interface — chrome + content)
 *   /es/foo/...                          → Spanish (content-only — content in
 *                                          `es`, chrome falls back to the
 *                                          default interface locale; see
 *                                          `toInterfaceLocale`)
 *   /xyz/foo/...                         → 404 (not a routable locale)
 */

import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'

import { TranslationsProvider } from '@/i18n/client/translations-provider'
import { isRoutableLocale, toInterfaceLocale } from '@/i18n/i18n-config'
import { getTranslations } from '@/i18n/translations'
import { RouteProgressBar } from '@/ui/components/route-progress-bar'

export const Route = createFileRoute('/$lng')({
  // Constrain `lng` to the configured routable set at the matcher level.
  // Invalid locale prefixes 404 at the matcher — before any lifecycle hook.
  // `lng` is always present (required segment, guaranteed by `rewrite.input`).
  params: {
    parse: ({ lng }) => {
      if (!isRoutableLocale(lng)) {
        throw notFound()
      }
      return { lng }
    },
    stringify: ({ lng }) => ({ lng }),
  },
  // `context.locale` is the URL's locale (may be a content-only locale); it
  // drives content fetching + meta downstream.
  beforeLoad: ({ params }) => ({ locale: params.lng }),
  // Chrome bundle keys off the INTERFACE locale: a content-only locale (e.g.
  // `zh-CN`) has no frontend UI translations and falls back to the default
  // interface locale. `toInterfaceLocale` is a pure function of the URL locale
  // (no cookie / Accept-Language consult), so the rendered chrome is
  // deterministic per URL and a content-only-locale page stays cacheable on a
  // shared URL-keyed proxy — see docs/I18N-ANALYSIS.md "Option B".
  loader: async ({ context }) => {
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
