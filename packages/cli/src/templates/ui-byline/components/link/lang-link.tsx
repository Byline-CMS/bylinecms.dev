/**
 * Locale-aware Link STUB.
 *
 * The reference webapp ships a real `LangLink` that injects an optional
 * `{-$lng}` path parameter onto TanStack Router's `<Link>` so that the
 * current locale survives client-side navigation. This stub is a thin
 * pass-through — it accepts the `lng` prop but does NOT prefix URLs.
 *
 * If your app is single-locale, this is fine as-is.
 *
 * If you have a multi-locale strategy, replace the body with your own
 * Link wrapper. The reference implementation lives at
 *   apps/webapp/src/i18n/components/lang-link.tsx
 * in https://github.com/Byline-CMS/bylinecms.dev.
 */

import type React from 'react'
import { Link } from '@tanstack/react-router'

import type { Locale } from '../../types/i18n'

export interface LangLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  to: string
  lng?: Locale
  params?: Record<string, string | undefined>
  search?:
    | true
    | Record<string, unknown>
    | ((current: Record<string, unknown>) => Record<string, unknown>)
  forceReload?: boolean
  scroll?: boolean
  replace?: boolean
  ref?: React.Ref<HTMLAnchorElement>
  children?: React.ReactNode
}

export function LangLink({
  to,
  lng: _lng,
  params,
  search,
  forceReload,
  scroll,
  replace,
  ref,
  children,
  ...rest
}: LangLinkProps): React.JSX.Element {
  if (forceReload) {
    return (
      <a href={to} ref={ref} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link
      to={to}
      params={params}
      search={search}
      resetScroll={scroll}
      replace={replace}
      ref={ref}
      {...rest}
    >
      {children}
    </Link>
  )
}
