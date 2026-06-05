/**
 * Locale-aware Link component for TanStack Router.
 *
 * Wraps TanStack Router's `<Link>` and automatically injects the required
 * `$lng` path parameter based on the current (or explicitly supplied) locale.
 *
 * Clean URLs for the default locale (e.g. `/about` instead of `/en/about`)
 * are produced by the router's `rewrite.output` (`src/i18n/locale-rewrite.ts`),
 * which strips the `/en` prefix from the generated href.
 *
 * When `forceReload` is true, a plain `<a>` tag is rendered instead,
 * triggering a full page navigation; that branch builds the clean public
 * href directly (no router, so no `output` rewrite applies).
 */

import type React from 'react'
import { Link } from '@tanstack/react-router'

import { lngParam, toLocaleRoute, useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig, type RoutableLocale } from '@/i18n/i18n-config'
import { isLocalizablePath } from '@/i18n/locale-rewrite'

export interface LangLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  /** Route path — use clean paths like '/about', not '/$lng/about'. The locale prefix is added automatically. */
  to: string
  /** Target locale — defaults to the current **interface** locale, so
   * generic navigation reverts off a content-only prefix. Pass a content
   * locale explicitly for the per-page "read this in…" affordance. */
  lng?: RoutableLocale
  /** Additional route params besides lng */
  params?: Record<string, string | undefined>
  /** Search / query string parameters */
  search?:
    | true
    | Record<string, unknown>
    | ((current: Record<string, unknown>) => Record<string, unknown>)
  /** Trigger a full-page reload instead of client-side navigation */
  forceReload?: boolean
  /** TanStack Router prefetch strategy. 'intent' (hover/focus),
   * 'viewport' (IntersectionObserver), 'render' (on mount), or false. */
  preload?: 'intent' | 'viewport' | 'render' | false
  /** Delay (ms) before preloading on 'intent'. */
  preloadDelay?: number
  /** Whether to scroll to top on navigation (default: true) */
  scroll?: boolean
  /** Replace the current history entry */
  replace?: boolean
  ref?: React.Ref<HTMLAnchorElement>
  children?: React.ReactNode
}

export function LangLink({
  to,
  children,
  lng,
  params = {},
  search,
  forceReload,
  scroll = true,
  replace = false,
  preload,
  preloadDelay,
  ref,
  ...rest
}: LangLinkProps) {
  const currentInterfaceLocale = useInterfaceLocale()
  const targetLocale = lng ?? currentInterfaceLocale
  const localeParam = lngParam(targetLocale)

  // A `to` that targets a non-localized route (the `_byline` admin tree —
  // `/admin`, `/sign-in`, …) must NOT be locale-prefixed: those routes are
  // locale-less siblings of the `$lng` tree, so `/fr/admin` would 404. The
  // same `isLocalizablePath` predicate the router rewrite uses is the single
  // source of truth. On the default locale this was previously masked by
  // `rewrite.output` stripping `/en`; on a non-default locale it breaks.
  const localeAware = isLocalizablePath(to)

  if (forceReload === true) {
    // Build a simple href string for full-page navigation.
    const prefix =
      localeAware && targetLocale !== i18nConfig.defaultLocale ? `/${targetLocale}` : ''
    return (
      <a
        href={`${prefix}${to}`}
        ref={ref}
        {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    )
  }

  if (!localeAware) {
    // Plain, locale-less link to a non-localized route.
    return (
      <Link
        to={to}
        params={params as never}
        search={search}
        replace={replace}
        resetScroll={scroll}
        preload={preload}
        preloadDelay={preloadDelay}
        ref={ref}
        {...rest}
      >
        {children}
      </Link>
    )
  }

  return (
    <Link
      to={toLocaleRoute(to)}
      params={{ ...params, ...localeParam } as never}
      search={search}
      replace={replace}
      resetScroll={scroll}
      preload={preload}
      preloadDelay={preloadDelay}
      ref={ref}
      {...rest}
    >
      {children}
    </Link>
  )
}
