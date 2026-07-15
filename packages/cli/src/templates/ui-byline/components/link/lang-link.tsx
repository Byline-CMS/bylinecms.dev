/**
 * Locale-aware Link STUB.
 *
 * This stub is a thin pass-through: it accepts the `lng` prop but does not
 * prefix URLs. A localized app can replace the body with a wrapper that
 * injects its locale path parameter into TanStack Router's `<Link>`.
 *
 * If your app is single-locale, this is fine as-is.
 *
 * If you have a multi-locale strategy, replace the body with your own Link wrapper.
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
