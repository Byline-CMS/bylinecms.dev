/**
 * Locale-aware navigation hook for TanStack Router.
 *
 * Replaces the Next.js useLangNavigation hook. In TanStack Router the locale
 * is an optional path parameter {-$lng}, so navigation works by passing the
 * `lng` param to the router's navigate/Link APIs.
 *
 * When the locale changes (differs from the cookie value) the hook also
 * persists the new preference via the setLanguageFn server function.
 */

import { useNavigate, useParams } from '@tanstack/react-router'

import { i18nConfig, type Locale } from '@/i18n/i18n-config'
import { setLanguageFn } from '@/i18n/set-language-fn'

/**
 * Returns the resolved locale from the current route's optional {-$lng} param.
 * If the param is absent the default locale is returned.
 */
export function useLocale(): Locale {
  const params = useParams({ strict: false }) as { lng?: string }
  return (params.lng as Locale) ?? i18nConfig.defaultLocale
}

/**
 * Returns a locale param object suitable for passing to TanStack Router's
 * `<Link params={...}>` or `navigate({ params: ... })`.
 *
 * For the default locale the param is `undefined` so it produces clean URLs
 * (e.g. `/admin` instead of `/en/admin`).
 */
export function lngParam(locale: Locale): { lng: string | undefined } {
  return { lng: locale === i18nConfig.defaultLocale ? undefined : locale }
}

/**
 * Prepend the optional locale segment to a clean path so it matches the
 * generated TanStack route IDs (e.g. `'/admin'` → `'/{-$lng}/admin'`).
 * Paths that already have the prefix are returned unchanged.
 */
export function toLocaleRoute(path: string): string {
  if (path.startsWith('/{-$lng}')) return path
  return path === '/' ? '/{-$lng}' : `/{-$lng}${path}`
}

interface NavigateOptions {
  /** The path to navigate to (e.g. '/admin/collections/$collection') */
  to: string
  /** Target locale — defaults to whatever is in the current URL */
  locale?: Locale
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

  const navigateWithLocale = async ({
    to,
    locale,
    params = {},
    replace = false,
    scroll = true,
  }: NavigateOptions) => {
    const targetLocale = locale ?? currentLocale

    // If the locale is changing, persist it to the cookie
    if (targetLocale !== currentLocale) {
      await setLanguageFn({ data: { lng: targetLocale } })
    }

    navigate({
      to: toLocaleRoute(to),
      params: { ...params, ...lngParam(targetLocale) } as never,
      replace,
      resetScroll: scroll,
    })
  }

  return {
    navigate: navigateWithLocale,
    currentLocale,
    lngParam: lngParam(currentLocale),
  }
}
