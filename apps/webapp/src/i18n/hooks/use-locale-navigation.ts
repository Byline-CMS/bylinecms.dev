/**
 * Locale-aware navigation hook for TanStack Router.
 *
 * Replaces the Next.js useLangNavigation hook. In TanStack Router the locale
 * is a required path parameter `$lng`, so navigation works by passing the
 * `lng` param to the router's navigate/Link APIs. Clean URLs for the default
 * locale come from the router's `rewrite.output`, not from omitting the param.
 *
 * When the locale changes (differs from the cookie value) the hook also
 * persists the new preference via the setLanguageFn server function.
 */

import { useNavigate, useRouterState } from '@tanstack/react-router'

import {
  i18nConfig,
  isInterfaceLocale,
  isRoutableLocale,
  type Locale,
  type RoutableLocale,
  routableLocales,
  toInterfaceLocale,
} from '@/i18n/i18n-config'
import { setLanguageFn } from '@/i18n/set-language-fn'
import { buildLocalizedPath } from '@/lib/meta'

/**
 * Strip a leading routable-locale segment (interface *or* content) from a
 * pathname, yielding the locale-agnostic path. `/fr/about-byline` → `/about-byline`,
 * `/fr` → `/`, `/about-byline` → `/about-byline` (unchanged). Used when switching
 * the locale prefix on the current page so we never stack prefixes (`/es/fr/...`).
 */
export function stripRoutableLocalePrefix(pathname: string): string {
  for (const loc of routableLocales) {
    if (pathname === `/${loc}`) return '/'
    if (pathname.startsWith(`/${loc}/`)) return pathname.slice(loc.length + 1)
  }
  return pathname
}

/**
 * Returns the **path** locale for the current URL — the locale actually in
 * the URL, which may be a content-only locale (e.g. `fr`). This is what
 * drives content rendering, meta, and the per-page content-language
 * affordance's active state.
 *
 * Derived from the first path segment rather than `params.lng` so it reads
 * uniformly regardless of route depth. Post-`rewrite.input`, the router's
 * internal pathname always carries a locale segment; this still falls back
 * to the default locale when the first segment is absent or unrecognised
 * (e.g. a locale-less admin path).
 *
 * For **chrome** (nav links, the language switcher) use
 * `useInterfaceLocale()` instead — generic navigation must revert off a
 * content-only prefix to the visitor's interface locale, not keep `/fr`
 * sticky across the session.
 */
export function useLocale(): RoutableLocale {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const firstSegment = pathname.split('/')[1] ?? ''
  if (isRoutableLocale(firstSegment)) {
    return firstSegment
  }
  return i18nConfig.defaultLocale
}

/**
 * Returns the **interface** locale for the current URL: the path locale if
 * it's an interface locale, otherwise the default. Drives chrome bundles
 * and the default target for generic navigation, so a content-only prefix
 * (`/fr`) reverts to the visitor's interface locale rather than sticking.
 */
export function useInterfaceLocale(): Locale {
  return toInterfaceLocale(useLocale())
}

/**
 * Returns a locale param object suitable for passing to TanStack Router's
 * `<Link params={...}>` or `navigate({ params: ... })`.
 *
 * `$lng` is a REQUIRED segment, so the param is always set (including the
 * default locale). Clean URLs for the default locale are produced by the
 * router's `rewrite.output` (`src/i18n/locale-rewrite.ts`), which strips the
 * `/en` prefix from generated hrefs — not by omitting the param here.
 */
export function lngParam(locale: RoutableLocale): { lng: RoutableLocale } {
  return { lng: locale }
}

/**
 * Prepend the required locale segment to a clean path so it matches the
 * generated TanStack route IDs (e.g. `'/about'` → `'/$lng/about'`). Paths
 * that already have the prefix are returned unchanged. The router's
 * `rewrite.input` re-localises bare paths too, but routing through the typed
 * `$lng` route id keeps `<Link>`/`navigate` type-safe.
 */
export function toLocaleRoute(path: string): string {
  if (path.startsWith('/$lng')) return path
  return path === '/' ? '/$lng' : `/$lng${path}`
}

interface NavigateOptions {
  /** The path to navigate to (e.g. '/admin/collections/$collection') */
  to: string
  /** Target locale — defaults to whatever is in the current URL. May be a
   * content-only locale (e.g. the "read this in…" affordance). */
  locale?: RoutableLocale
  /** Additional route params (besides lng) */
  params?: Record<string, string | undefined>
  /** Replace the current history entry instead of pushing */
  replace?: boolean
  /** Scroll to top after navigation */
  scroll?: boolean
}

export function useLocaleNavigation() {
  const navigate = useNavigate()
  const currentLocale = useLocale()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const navigateWithLocale = async ({
    to,
    locale,
    params = {},
    replace = false,
    scroll = true,
  }: NavigateOptions) => {
    const targetLocale = locale ?? currentLocale

    // Persist the choice only when switching the *interface* locale — the
    // `lng` cookie holds interface locales only. A content-locale target
    // (e.g. navigating to `/fr/...` via the per-page affordance) must NOT
    // write the cookie, so the prefix stays opt-in per document and does
    // not stick across the session.
    if (isInterfaceLocale(targetLocale) && targetLocale !== currentLocale) {
      await setLanguageFn({ data: { lng: targetLocale } })
    }

    navigate({
      to: toLocaleRoute(to),
      params: { ...params, ...lngParam(targetLocale) } as never,
      replace,
      resetScroll: scroll,
    })
  }

  /**
   * Switch the content locale on the **current** page, keeping the same
   * document. Strips any existing routable-locale prefix from the current
   * pathname and re-prepends the target (omitted for the default locale,
   * e.g. `/about-byline` ↔ `/fr/about-byline`). Document slugs are not
   * localized — `path` is anchored to the source locale — so the path is
   * identical across locales and only the prefix changes; the rebuilt target
   * is exactly the hreflang alternate path (`buildLocalizedPath`, the same
   * resolver `resolveAlternates` uses), so the visible switcher and the SEO
   * signal can never diverge.
   *
   * Used by the per-page "Also available in…" affordance. Cookie persistence
   * follows the same rule as `navigateWithLocale` — written only for an
   * interface-locale target, so a content-only prefix stays non-sticky.
   */
  const switchContentLocale = async (locale: RoutableLocale) => {
    if (locale === currentLocale) return

    if (isInterfaceLocale(locale) && locale !== currentLocale) {
      await setLanguageFn({ data: { lng: locale } })
    }

    const cleanPath = stripRoutableLocalePrefix(pathname)
    const segments = cleanPath.split('/').filter(Boolean)
    navigate({ to: buildLocalizedPath(locale, ...segments), resetScroll: true })
  }

  return {
    navigate: navigateWithLocale,
    switchContentLocale,
    currentLocale,
    lngParam: lngParam(currentLocale),
  }
}
