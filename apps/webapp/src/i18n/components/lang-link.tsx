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

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig, type Locale } from '@/i18n/i18n-config'

export interface LangLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  /** Route path — use clean paths like '/about', not '/{-$lng}/about'. The locale prefix is added automatically. */
  to: string
  /** Target locale — defaults to the current route locale */
  lng?: Locale
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

/**
 * Prepend the optional locale segment to a clean path so it matches the
 * generated TanStack route IDs (e.g. `'/about'` → `'/{-$lng}/about'`).
 */
function toLocaleRoute(path: string): string {
  if (path.startsWith('/{-$lng}')) return path
  return path === '/' ? '/{-$lng}' : `/{-$lng}${path}`
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
  const currentLocale = useLocale()
  const targetLocale = lng ?? currentLocale
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
