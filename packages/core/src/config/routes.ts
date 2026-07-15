/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RoutesConfig } from '@/@types/site-config.js'

/** Default route paths. Installations override any key on the
 * config object; callers read the merged shape via `resolveRoutes()`. */
const DEFAULT_ROUTES: RoutesConfig = {
  admin: '/admin',
  api: '/api',
  signIn: '/sign-in',
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function normalizeRouteSegment(value: string | undefined, fallback: string, name: string): string {
  const path = normalizeRoutePath(value, fallback, name)
  if (path.slice(1).includes('/')) {
    throw new Error(`routes.${name} must contain exactly one URL path segment`)
  }
  return path
}

function normalizeRoutePath(value: string | undefined, fallback: string, name: string): string {
  const input = value?.trim() || fallback
  if (
    input.includes('\\') ||
    input.includes('?') ||
    input.includes('#') ||
    input.includes('%') ||
    input.includes(':') ||
    /\s/.test(input) ||
    hasControlCharacter(input)
  ) {
    throw new Error(
      `routes.${name} must be an unencoded URL path without query, hash, whitespace, backslashes, or control characters`
    )
  }

  const segments = input.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`routes.${name} must contain at least one URL path segment`)
  }

  return `/${segments.join('/')}`
}

/**
 * Merge a user-supplied (potentially partial) routes config with the
 * built-in defaults. Empty / unset keys fall back to `'/admin'`, `'/api'`,
 * and `'/sign-in'`. Returns a fully-populated `RoutesConfig` so consumers
 * don't need null checks at every call site.
 */
export function resolveRoutes(routes?: Partial<RoutesConfig>): RoutesConfig {
  const admin = normalizeRouteSegment(routes?.admin, DEFAULT_ROUTES.admin, 'admin')
  const api = normalizeRouteSegment(routes?.api, DEFAULT_ROUTES.api, 'api')
  if (routes?.signIn?.trim().startsWith('//')) {
    throw new Error('routes.signIn must not be a protocol-relative URL')
  }
  const signIn = normalizeRoutePath(routes?.signIn, DEFAULT_ROUTES.signIn, 'signIn')
  if (admin === api) throw new Error('routes.admin and routes.api must use different URL segments')
  if (
    signIn === admin ||
    signIn.startsWith(`${admin}/`) ||
    signIn === api ||
    signIn.startsWith(`${api}/`)
  ) {
    throw new Error('routes.signIn must be outside the admin and API route trees')
  }
  return { admin, api, signIn }
}
