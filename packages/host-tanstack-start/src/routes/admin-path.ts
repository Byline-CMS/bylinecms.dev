/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getClientConfig, resolveRoutes } from '@byline/core'

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

/** Build an admin URL or parameterized TanStack route from client-safe config. */
export function getAdminRoutePath(...segments: ReadonlyArray<string | number>): string {
  const configuredBase = resolveRoutes(getClientConfig().routes).admin
  const normalizedBase = configuredBase.replace(/^\/+|\/+$/g, '')
  const base = normalizedBase ? `/${normalizedBase}` : '/'
  const suffix = segments
    .map((segment) => String(segment).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')

  if (!suffix) return base
  return base === '/' ? `/${suffix}` : `${base}/${suffix}`
}

/** Build the matching pathless-group route ID used by generated host route trees. */
export function getAdminRouteId(...segments: ReadonlyArray<string | number>): string {
  return `/_byline${getAdminRoutePath(...segments)}`
}

/** True when a pathname is the target route or one of its segment-delimited descendants. */
export function isRoutePathWithin(pathname: string, target: string): boolean {
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const base = target.length > 1 ? target.replace(/\/+$/, '') : target
  return (
    current === base || (base === '/' ? current.startsWith('/') : current.startsWith(`${base}/`))
  )
}

/**
 * Accept an untrusted callback only when it is an unencoded, same-origin path
 * inside the configured admin mount.
 */
export function resolveAdminCallbackPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return undefined
  if (!value.startsWith('/') || value.startsWith('//')) return undefined
  if (value.includes('\\') || hasControlCharacter(value)) return undefined
  if (value.split(/[?#]/, 1)[0]?.includes('%')) return undefined

  let url: URL
  try {
    url = new URL(value, 'https://byline.invalid')
  } catch {
    return undefined
  }

  if (url.origin !== 'https://byline.invalid') return undefined
  if (!isRoutePathWithin(url.pathname, getAdminRoutePath())) return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

/** Resolve an untrusted callback or fall back to the configured admin dashboard. */
export function resolveAdminSignInRedirect(value: unknown): string {
  return resolveAdminCallbackPath(value) ?? getAdminRoutePath()
}

/** Match the admin root exactly and admin child entries by pathname prefix. */
export function isAdminRoutePathActive(
  pathname: string,
  ...segments: ReadonlyArray<string>
): boolean {
  const target = getAdminRoutePath(...segments)
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (segments.length === 0) return current === target
  return isRoutePathWithin(current, target)
}
