import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  evaluateExportedArrayObjectProperties,
  evaluateExportedObjectProperties,
  hasExportedCoreResolveRoutesCall,
  type StaticResult,
} from './static-config.js'
import { normalizeTemplateSource } from './template-path.js'
import type { Context } from '../context.js'

export const DEFAULT_ADMIN_PATH = '/admin'
export const DEFAULT_SIGN_IN_PATH = '/sign-in'

const ROUTE_SEGMENT_REGEX = /^[a-z][a-z0-9-]*$/
const SYSTEM_ROUTE_SEGMENTS = new Set(['_serverfn', '_build', 'uploads', 'static', 'public'])
const FILESYSTEM_SPECIAL_SEGMENTS = new Set(['index', 'route'])
const PREVIOUS_RELEASE_ROUTES_SOURCE = `/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-safe URL paths for admin, sign-in, and the future public API.
 * \`resolveRoutes()\` applies defaults and canonicalizes every consumer.
 */

import type { RoutesConfig } from '@byline/core'

export const routes: Partial<RoutesConfig> = {
  admin: '/admin',
  api: '/api',
  signIn: '/sign-in',
}

/**
 * Fallback used by both server and admin entry points when no
 * \`VITE_SERVER_URL\` env var is set. Each entry resolves the env var
 * itself (Vite's \`import.meta.env\` on the client, Node's \`process.env\`
 * on the server) and falls back to this literal.
 */
export const DEFAULT_SERVER_URL = 'http://localhost:5173/'
`

export interface ValidatedRoutePaths {
  adminPath: string
  adminSegments: string[]
  apiPath: string
  apiSegments: string[]
  signInPath: string
  signInSegments: string[]
}

export interface GeneratedRoutesSource {
  adminPath: string
  apiPath: string
  signInPath: string
}

export interface StaticRouteConfig {
  admin: string
  api: string
  signIn: string
}

type ValidationResult = { ok: true; value: ValidatedRoutePaths } | { ok: false; error: string }

export function validateRoutePaths(
  ctx: Context,
  adminInput = DEFAULT_ADMIN_PATH,
  signInInput = DEFAULT_SIGN_IN_PATH,
  apiInput?: string
): ValidationResult {
  let resolvedApiInput = apiInput
  if (resolvedApiInput === undefined) {
    const configured = readConfiguredRoutes(ctx)
    if (!configured.ok) return configured
    resolvedApiInput = configured.value.api
  }
  const admin = canonicalizePath(adminInput, 'admin', DEFAULT_ADMIN_PATH)
  if (!admin.ok) return admin
  const api = canonicalizePath(resolvedApiInput, 'API', '/api')
  if (!api.ok) return api
  const signIn = canonicalizePath(signInInput, 'sign-in', DEFAULT_SIGN_IN_PATH)
  if (!signIn.ok) return signIn

  const adminRoot = admin.segments[0]
  const apiRoot = api.segments[0]
  const signInRoot = signIn.segments[0]
  if (!adminRoot || !apiRoot || !signInRoot) {
    return { ok: false, error: 'route paths must not be empty' }
  }

  const reservedResult = reservedRouteSegments(ctx)
  if (!reservedResult.ok) return reservedResult
  const reserved = reservedResult.value
  if (reserved.has(adminRoot) || SYSTEM_ROUTE_SEGMENTS.has(adminRoot)) {
    return {
      ok: false,
      error: `invalid admin path "${adminInput}" — "${adminRoot}" conflicts with a locale or system route tree`,
    }
  }
  if (reserved.has(apiRoot) || SYSTEM_ROUTE_SEGMENTS.has(apiRoot)) {
    return {
      ok: false,
      error: `invalid API path "${resolvedApiInput}" — "${apiRoot}" conflicts with a locale or system route tree`,
    }
  }
  if (reserved.has(signInRoot) || SYSTEM_ROUTE_SEGMENTS.has(signInRoot)) {
    return {
      ok: false,
      error: `invalid sign-in path "${signInInput}" — "${signInRoot}" conflicts with a locale or system route tree`,
    }
  }
  if (pathsOverlap(admin.path, api.path)) {
    return {
      ok: false,
      error: `invalid admin path "${adminInput}" — conflicts with API path "${api.path}"; they must use separate route trees`,
    }
  }
  if (pathsOverlap(signIn.path, admin.path)) {
    if (signIn.path === DEFAULT_SIGN_IN_PATH && admin.path !== DEFAULT_ADMIN_PATH) {
      return {
        ok: false,
        error: `invalid admin path "${adminInput}" — conflicts with the sign-in route`,
      }
    }
    return {
      ok: false,
      error: `invalid sign-in path "${signInInput}" — conflicts with the admin route tree`,
    }
  }
  if (pathsOverlap(signIn.path, api.path)) {
    return {
      ok: false,
      error: `invalid sign-in path "${signInInput}" — conflicts with the API route tree`,
    }
  }
  const adminSpecial = admin.segments.find((segment) => FILESYSTEM_SPECIAL_SEGMENTS.has(segment))
  if (adminSpecial !== undefined) {
    return {
      ok: false,
      error: `invalid admin path "${adminInput}" — "${adminSpecial}" is reserved by TanStack file routing`,
    }
  }
  const apiSpecial = api.segments.find((segment) => FILESYSTEM_SPECIAL_SEGMENTS.has(segment))
  if (apiSpecial !== undefined) {
    return {
      ok: false,
      error: `invalid API path "${resolvedApiInput}" — "${apiSpecial}" is reserved by TanStack file routing`,
    }
  }
  const signInSpecial = signIn.segments.find((segment) => FILESYSTEM_SPECIAL_SEGMENTS.has(segment))
  if (signInSpecial !== undefined) {
    return {
      ok: false,
      error: `invalid sign-in path "${signInInput}" — "${signInSpecial}" is reserved by TanStack file routing`,
    }
  }

  return {
    ok: true,
    value: {
      adminPath: admin.path,
      adminSegments: admin.segments,
      apiPath: api.path,
      apiSegments: api.segments,
      signInPath: signIn.path,
      signInSegments: signIn.segments,
    },
  }
}

/** Recognize only generated routes.ts sources with route literals as the sole variation. */
export function recognizeGeneratedRoutesSource(
  source: string,
  canonical: string
): GeneratedRoutesSource | null {
  const parsed = readStaticRoutesSource(source)
  if (!parsed.ok) return null
  const current = renderGeneratedRoutesSource(
    canonical,
    parsed.value.admin,
    '/api',
    parsed.value.signIn
  )
  if (normalizeTemplateSource(source) === normalizeTemplateSource(current)) {
    return {
      adminPath: parsed.value.admin,
      apiPath: parsed.value.api,
      signInPath: parsed.value.signIn,
    }
  }
  const previous = renderGeneratedRoutesSource(
    PREVIOUS_RELEASE_ROUTES_SOURCE,
    parsed.value.admin,
    '/api',
    parsed.value.signIn
  )
  return normalizeTemplateSource(source) === normalizeTemplateSource(previous)
    ? {
        adminPath: parsed.value.admin,
        apiPath: parsed.value.api,
        signInPath: parsed.value.signIn,
      }
    : null
}

export function readStaticRoutesSource(source: string): StaticResult<StaticRouteConfig> {
  const evaluated = evaluateExportedObjectProperties(source, 'routes', ['admin', 'api', 'signIn'])
  if (!evaluated.ok) return evaluated
  const routes = {
    admin: evaluated.value.admin ?? DEFAULT_ADMIN_PATH,
    api: evaluated.value.api ?? '/api',
    signIn: evaluated.value.signIn ?? DEFAULT_SIGN_IN_PATH,
  }
  if (
    typeof routes.admin !== 'string' ||
    typeof routes.api !== 'string' ||
    typeof routes.signIn !== 'string'
  ) {
    return staticFailure('routes.api, routes.admin, and routes.signIn must be static strings')
  }
  return { ok: true, value: routes as StaticRouteConfig }
}

export function routesSourceAligned(
  source: string,
  ctx: Context,
  expected: ValidatedRoutePaths
): boolean {
  const routes = readStaticRoutesSource(source)
  if (!routes.ok) return false
  const validated = validateRoutePaths(
    ctx,
    routes.value.admin,
    routes.value.signIn,
    routes.value.api
  )
  return (
    validated.ok &&
    validated.value.adminPath === expected.adminPath &&
    validated.value.apiPath === expected.apiPath &&
    validated.value.signInPath === expected.signInPath
  )
}

export function renderGeneratedRoutesSource(
  canonical: string,
  adminPath: string,
  apiPath: string,
  signInPath: string
): string {
  return canonical
    .replace(/(admin\s*:\s*['"])[^'"]+(['"])/, `$1${adminPath}$2`)
    .replace(/(api\s*:\s*['"])[^'"]+(['"])/, `$1${apiPath}$2`)
    .replace(/(signIn\s*:\s*['"])[^'"]+(['"])/, `$1${signInPath}$2`)
}

export function validateCanonicalRoutesSource(source: string): StaticResult<StaticRouteConfig> {
  if (!hasExportedCoreResolveRoutesCall(source, 'routes')) {
    return staticFailure('canonical routes.ts must export the recognized core resolveRoutes call')
  }
  const parsed = readStaticRoutesSource(source)
  if (!parsed.ok) return parsed
  if (
    parsed.value.admin !== DEFAULT_ADMIN_PATH ||
    parsed.value.api !== '/api' ||
    parsed.value.signIn !== DEFAULT_SIGN_IN_PATH
  ) {
    return staticFailure('canonical routes.ts must contain the default route values')
  }
  const probe = readStaticRoutesSource(
    renderGeneratedRoutesSource(source, '/probe/admin', '/probe/api', '/probe/sign-in')
  )
  if (
    !probe.ok ||
    probe.value.admin !== '/probe/admin' ||
    probe.value.api !== '/probe/api' ||
    probe.value.signIn !== '/probe/sign-in'
  ) {
    return staticFailure('canonical routes.ts route literals cannot be transformed safely')
  }
  return parsed
}

export function canonicalRoutesTemplatePath(ctx: Context): string {
  const prefix = ctx.state.get().answers.examples !== false ? 'byline-examples' : 'byline'
  return join(ctx.templatesDir(), prefix, 'routes.ts')
}

function canonicalizePath(
  input: string,
  label: string,
  fallback: string
): { ok: true; path: string; segments: string[] } | { ok: false; error: string } {
  const trimmed = input.trim() || fallback
  if (
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('%') ||
    trimmed.includes(':') ||
    /\s/.test(trimmed)
  ) {
    return {
      ok: false,
      error: `invalid ${label} path "${input}" — must be an unencoded root-relative URL path`,
    }
  }

  const segments = trimmed.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => !ROUTE_SEGMENT_REGEX.test(segment))) {
    return {
      ok: false,
      error: `invalid ${label} path "${input}" — must contain one or more segments matching ${ROUTE_SEGMENT_REGEX}`,
    }
  }

  return { ok: true, path: `/${segments.join('/')}`, segments }
}

function reservedRouteSegments(ctx: Context): StaticResult<Set<string>> {
  const reserved = new Set<string>()
  const examples = ctx.state.get().answers.examples !== false
  const localePath = ctx.resolve('byline/locales.ts')
  const publicLocalePath = ctx.resolve('src/i18n/i18n-config.ts')
  const templatePrefix = examples ? 'byline-examples' : 'byline'
  const selectedLocalePath = existsSync(localePath)
    ? localePath
    : join(ctx.templatesDir(), templatePrefix, 'locales.ts')

  if (existsSync(selectedLocalePath)) {
    const locales = readContentLocaleCodes(readFileSync(selectedLocalePath, 'utf8'))
    if (!locales.ok) return configFailure(selectedLocalePath, locales.error)
    for (const locale of locales.value) reserved.add(locale.toLowerCase())
  }
  if (existsSync(publicLocalePath)) {
    const locales = readPublicLocaleValues(readFileSync(publicLocalePath, 'utf8'))
    if (!locales.ok) return configFailure(publicLocalePath, locales.error)
    for (const locale of [...locales.value.locales, locales.value.defaultLocale]) {
      reserved.add(locale.toLowerCase())
    }
  }

  return { ok: true, value: reserved }
}

function readConfiguredRoutes(ctx: Context): StaticResult<StaticRouteConfig> {
  const installedPath = ctx.resolve('byline/routes.ts')
  const path = existsSync(installedPath) ? installedPath : canonicalRoutesTemplatePath(ctx)
  if (!existsSync(path)) return configFailure(path, 'canonical routes.ts template is missing')
  const source = readFileSync(path, 'utf8')
  if (existsSync(installedPath)) {
    const routes = readStaticRoutesSource(source)
    return routes.ok ? routes : configFailure(path, routes.error)
  }
  const canonical = validateCanonicalRoutesSource(source)
  return canonical.ok
    ? canonical
    : configFailure(path, `canonical routes.ts template is invalid (${canonical.error})`)
}

function readContentLocaleCodes(source: string): StaticResult<string[]> {
  const evaluated = evaluateExportedArrayObjectProperties(source, 'contentLocales', ['code'])
  if (!evaluated.ok) return evaluated
  const codes: string[] = []
  for (const locale of evaluated.value) {
    if (typeof locale.code !== 'string') {
      return staticFailure('contentLocales entries must have static string codes')
    }
    codes.push(locale.code)
  }
  return { ok: true, value: codes }
}

function readPublicLocaleValues(
  source: string
): StaticResult<{ locales: string[]; defaultLocale: string }> {
  const evaluated = evaluateExportedObjectProperties(source, 'i18nConfig', [
    'locales',
    'defaultLocale',
  ])
  if (!evaluated.ok) return evaluated
  const { locales, defaultLocale } = evaluated.value
  if (!Array.isArray(locales) || !locales.every((locale) => typeof locale === 'string')) {
    return staticFailure('i18nConfig.locales must be a static string array')
  }
  if (typeof defaultLocale !== 'string') {
    return staticFailure('i18nConfig.defaultLocale must be a static string')
  }
  return { ok: true, value: { locales, defaultLocale } }
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function configFailure(path: string, error: string): StaticResult<never> {
  return staticFailure(`${path}: manual — cannot safely resolve route configuration (${error})`)
}

function staticFailure(error: string): StaticResult<never> {
  return { ok: false, error }
}
