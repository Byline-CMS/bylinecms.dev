import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { normalizeTemplateSource } from './template-path.js'
import type { Context } from '../context.js'

export const DEFAULT_ADMIN_PATH = '/admin'
export const DEFAULT_SIGN_IN_PATH = '/sign-in'

const ROUTE_SEGMENT_REGEX = /^[a-z][a-z0-9-]*$/
const SYSTEM_ROUTE_SEGMENTS = new Set(['_serverfn', '_build', 'uploads', 'static', 'public', 'api'])
const FILESYSTEM_SPECIAL_SEGMENTS = new Set(['index', 'route'])
const CURRENT_ROUTES_DESCRIPTION = `/**
 * Client-safe URL paths for admin, sign-in, and the future public API.
 * \`resolveRoutes()\` applies defaults and canonicalizes every consumer.
 */`
const PRE_SIGN_IN_ROUTES_DESCRIPTION = `/**
 * URL segments for admin and (future) public API routes. Defaults of
 * \`/admin\` and \`/api\` are applied automatically by \`resolveRoutes()\` —
 * keys only need to be set here when overriding either default.
 */`

export interface ValidatedRoutePaths {
  adminPath: string
  adminSlug: string
  signInPath: string
  signInSegments: string[]
}

export interface GeneratedRoutesSource {
  adminPath: string
  /** Missing only for the exact generated predecessor from before routes.signIn existed. */
  signInPath?: string
}

type ValidationResult = { ok: true; value: ValidatedRoutePaths } | { ok: false; error: string }

export function validateRoutePaths(
  ctx: Context,
  adminInput = DEFAULT_ADMIN_PATH,
  signInInput = DEFAULT_SIGN_IN_PATH
): ValidationResult {
  const admin = canonicalizePath(adminInput, 'admin', false)
  if (!admin.ok) return admin
  const signIn = canonicalizePath(signInInput, 'sign-in', true)
  if (!signIn.ok) return signIn

  const adminSlug = admin.segments[0]
  const signInRoot = signIn.segments[0]
  if (!adminSlug || !signInRoot) return { ok: false, error: 'route paths must not be empty' }

  const reserved = reservedRouteSegments(ctx)
  if (adminSlug === 'sign-in' || reserved.has(adminSlug)) {
    return {
      ok: false,
      error: `invalid admin path "${adminInput}" — "${adminSlug}" conflicts with the sign-in, API, locale, or system route tree`,
    }
  }
  if (reserved.has(signInRoot) || signInRoot === adminSlug) {
    return {
      ok: false,
      error: `invalid sign-in path "${signInInput}" — "${signInRoot}" conflicts with the admin, API, locale, or system route tree`,
    }
  }
  const special = signIn.segments.find((segment) => FILESYSTEM_SPECIAL_SEGMENTS.has(segment))
  if (special) {
    return {
      ok: false,
      error: `invalid sign-in path "${signInInput}" — "${special}" is reserved by TanStack file routing`,
    }
  }

  return {
    ok: true,
    value: {
      adminPath: admin.path,
      adminSlug,
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
  const adminPath = source.match(/^\s*admin\s*:\s*['"]([^'"]+)['"],?\s*$/m)?.[1]
  if (!adminPath) return null
  const signInPath = source.match(/^\s*signIn\s*:\s*['"]([^'"]+)['"],?\s*$/m)?.[1]
  const expected = signInPath
    ? renderGeneratedRoutesSource(canonical, adminPath, signInPath)
    : renderPreSignInRoutesSource(canonical, adminPath)
  if (expected === null) return null
  return normalizeTemplateSource(source) === normalizeTemplateSource(expected)
    ? { adminPath, signInPath }
    : null
}

export function renderGeneratedRoutesSource(
  canonical: string,
  adminPath: string,
  signInPath: string
): string {
  return canonical
    .replace(/(admin\s*:\s*['"])[^'"]+(['"])/, `$1${adminPath}$2`)
    .replace(/(signIn\s*:\s*['"])[^'"]+(['"])/, `$1${signInPath}$2`)
}

function renderPreSignInRoutesSource(canonical: string, adminPath: string): string | null {
  const withoutSignIn = canonical
    .replace(CURRENT_ROUTES_DESCRIPTION, PRE_SIGN_IN_ROUTES_DESCRIPTION)
    .replace(/^\s*signIn\s*:\s*['"][^'"]+['"],?\s*\r?\n/m, '')
  if (
    withoutSignIn === canonical ||
    !canonical.includes(CURRENT_ROUTES_DESCRIPTION) ||
    !withoutSignIn.includes(PRE_SIGN_IN_ROUTES_DESCRIPTION)
  ) {
    return null
  }
  return withoutSignIn.replace(/(admin\s*:\s*['"])[^'"]+(['"])/, `$1${adminPath}$2`)
}

function canonicalizePath(
  input: string,
  label: string,
  allowNested: boolean
): { ok: true; path: string; segments: string[] } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (
    trimmed.length === 0 ||
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
  if (
    segments.length === 0 ||
    (!allowNested && segments.length !== 1) ||
    segments.some((segment) => !ROUTE_SEGMENT_REGEX.test(segment))
  ) {
    const shape = allowNested
      ? `one or more segments matching ${ROUTE_SEGMENT_REGEX}`
      : `one segment matching ${ROUTE_SEGMENT_REGEX}`
    return { ok: false, error: `invalid ${label} path "${input}" — must contain ${shape}` }
  }

  return { ok: true, path: `/${segments.join('/')}`, segments }
}

function reservedRouteSegments(ctx: Context): Set<string> {
  const reserved = new Set(SYSTEM_ROUTE_SEGMENTS)
  const sources = [
    ctx.resolve('byline/routes.ts'),
    ctx.resolve('byline/locales.ts'),
    ctx.resolve('src/i18n/i18n-config.ts'),
    join(
      ctx.templatesDir(),
      ctx.state.get().answers.examples === false
        ? 'byline/locales.ts'
        : 'byline-examples/locales.ts'
    ),
  ]

  for (const path of sources) {
    if (!existsSync(path)) continue
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/\bapi\s*:\s*['"]\/?([^/'"]+)/g)) {
      if (match[1]) reserved.add(match[1].toLowerCase())
    }
    for (const match of source.matchAll(/\b(?:code|defaultLocale)\s*:\s*['"]([^'"]+)['"]/g)) {
      if (match[1]) reserved.add(match[1].toLowerCase())
    }
    for (const locales of source.matchAll(/\blocales\s*:\s*\[([\s\S]*?)\]/g)) {
      for (const locale of locales[1]?.matchAll(/['"]([^'"]+)['"]/g) ?? []) {
        if (locale[1]) reserved.add(locale[1].toLowerCase())
      }
    }
  }

  return reserved
}
