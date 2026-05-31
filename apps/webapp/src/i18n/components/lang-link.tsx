/**
 * Locale-aware Link component for TanStack Router.
 *
 * Wraps TanStack Router's `<Link>` and automatically injects the optional
 * `{-$lng}` path parameter based on the current (or explicitly supplied) locale.
 *
 * For the default locale the param is omitted, producing clean URLs
 * (e.g. `/about` instead of `/en/about`).
 *
 * When `forceReload` is true, a plain `<a>` tag is rendered instead,
 * triggering a full page navigation.
 */

import type React from 'react'
import { Link } from '@tanstack/react-router'

import { lngParam, toLocaleRoute, useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig, type RoutableLocale } from '@/i18n/i18n-config'

export interface LangLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  /** Route path — use clean paths like '/about', not '/{-$lng}/about'. The locale prefix is added automatically. */
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
  ref,
  ...rest
}: LangLinkProps) {
  const currentInterfaceLocale = useInterfaceLocale()
  const targetLocale = lng ?? currentInterfaceLocale
  const localeParam = lngParam(targetLocale)

  if (forceReload === true) {
    // Build a simple href string for full-page navigation
    const prefix = targetLocale !== i18nConfig.defaultLocale ? `/${targetLocale}` : ''
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

  return (
    <Link
      to={toLocaleRoute(to)}
      params={{ ...params, ...localeParam } as never}
      search={search}
      replace={replace}
      resetScroll={scroll}
      ref={ref}
      {...rest}
    >
      {children}
    </Link>
  )
}
