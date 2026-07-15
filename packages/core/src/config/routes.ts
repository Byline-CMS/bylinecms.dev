/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { normalizeRootRelativeRedirect } from '../utils/root-relative-redirect.js'
import type { RoutesConfig, RoutesConfigInput } from '@/@types/site-config.js'

/** Default route paths resolved at an explicit configuration boundary. */
const DEFAULT_ROUTES: RoutesConfig = {
  admin: '/admin',
  api: '/api',
  signIn: '/sign-in',
}

function normalizeRoutePath(value: string | undefined, fallback: string, name: string): string {
  const input = value?.trim() || fallback
  if (
    input.includes('\\') ||
    input.includes('?') ||
    input.includes('#') ||
    input.includes('%') ||
    input.includes(':') ||
    /\s/.test(input)
  ) {
    throw new Error(
      `routes.${name} must be an unencoded URL path without query, hash, whitespace, backslashes, or control characters`
    )
  }

  const segments = input.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`routes.${name} must contain at least one URL path segment`)
  }

  const normalized = `/${segments.join('/')}`
  if (normalizeRootRelativeRedirect(normalized) !== normalized) {
    throw new Error(`routes.${name} contains an unsafe URL code point`)
  }
  return normalized
}

/**
 * Merge a user-supplied (potentially partial) routes config with the
 * built-in defaults. Empty / unset keys fall back to `'/admin'`, `'/api'`,
 * and `'/sign-in'`. Returns a fully-populated `RoutesConfig` so consumers
 * don't need null checks at every call site.
 */
export function resolveRoutes(routes?: RoutesConfigInput): RoutesConfig {
  const admin = normalizeRoutePath(routes?.admin, DEFAULT_ROUTES.admin, 'admin')
  const api = normalizeRoutePath(routes?.api, DEFAULT_ROUTES.api, 'api')
  if (routes?.signIn?.trim().startsWith('//')) {
    throw new Error('routes.signIn must not be a protocol-relative URL')
  }
  const signIn = normalizeRoutePath(routes?.signIn, DEFAULT_ROUTES.signIn, 'signIn')
  if (pathsOverlap(admin, api)) {
    throw new Error('routes.admin and routes.api must use separate URL path trees')
  }
  if (pathsOverlap(signIn, admin) || pathsOverlap(signIn, api)) {
    throw new Error('routes.signIn must be outside the admin and API route trees')
  }
  return Object.freeze({ admin, api, signIn })
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}
