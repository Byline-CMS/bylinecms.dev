/**
 * Locale-aware Link component for TanStack Router.
 *
 * Wraps TanStack Router's `<Link>` and automatically injects the optional
 * `{-$lng}` path parameter based on the current (or explicitly supplied) locale.
 *
 * For the default locale the param is omitted, producing clean URLs
 * (e.g. `/admin` instead of `/en/admin`).
 *
 * When `forceReload` is true, a plain `<a>` tag is rendered instead,
 * triggering a full page navigation.
 */

import React from 'react'
import { Link } from '@tanstack/react-router'

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig, type Locale } from '@/i18n/i18n-config'

export interface LangLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  /** Route path — use clean paths like '/admin', not '/{-$lng}/admin'. The locale prefix is added automatically. */
  to: string
  /** Target locale — defaults to the current route locale */
  lng?: Locale
  /** Additional route params besides lng */
  params?: Record<string, string | undefined>
  /** Trigger a full-page reload instead of client-side navigation */
  forceReload?: boolean
  /** Whether to scroll to top on navigation (default: true) */
  scroll?: boolean
  /** Replace the current history entry */
  replace?: boolean
  children: React.ReactNode
}

/**
 * Prepend the optional locale segment to a clean path so it matches the
 * generated TanStack route IDs (e.g. `'/{-$lng}/admin'`).
 */
function toLocaleRoute(path: string): string {
  if (path.startsWith('/{-$lng}')) return path
  return path === '/' ? '/{-$lng}' : `/{-$lng}${path}`
}

export const LangLink = React.forwardRef<HTMLAnchorElement, LangLinkProps>(
  (
    { to, children, lng, params = {}, forceReload, scroll = true, replace = false, ...rest },
    ref
  ) => {
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
        replace={replace}
        resetScroll={scroll}
        ref={ref}
        {...rest}
      >
        {children}
      </Link>
    )
  }
)

LangLink.displayName = 'LangLink'
