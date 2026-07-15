import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { applyPlannedWrites } from '../lib/planned-writes.js'
import { normalizeTemplateSource, toPosixTemplatePath } from '../lib/template-path.js'
import type { Context } from '../context.js'
import type { FileWrite, Phase, Plan } from '../types.js'

const TEMPLATE_DIR = 'routes/_byline'
const TARGET_GROUP_DIR = 'src/routes/_byline'
const RUNTIME_ROUTES = 'byline/routes.ts'
const DEFAULT_ADMIN_PATH = '/admin'
const ADMIN_SLUG_REGEX = /^[a-z][a-z0-9-]*$/

export const routesPhase: Phase = {
  id: 'routes',
  title: 'Routes — install the _byline pathless route group',
  defaultMode: 'confirm',

  async detect(ctx) {
    const adminPath = ctx.state.get().answers.adminPath ?? DEFAULT_ADMIN_PATH
    const slug = pathToSlug(adminPath)
    if (!slug) return 'pending'
    const expected = routeWrites(ctx, slug)
    if (expected.length === 0 || expected.some((write) => !existsSync(write.path))) return 'pending'
    return runtimeRoutesAligned(ctx, adminPath) ? 'done' : 'pending'
  },

  async plan(ctx) {
    return buildRoutesPlan(ctx)
  },

  async apply(plan, ctx) {
    const adminPath = ctx.state.get().answers.adminPath ?? DEFAULT_ADMIN_PATH
    const slug = pathToSlug(adminPath)
    if (!slug) {
      ctx.logger.error(`invalid admin path: ${adminPath}`)
      return { state: 'blocked' }
    }
    if (routeWrites(ctx, slug).length === 0) {
      ctx.logger.error('no route templates found — was the CLI built with templates?')
      return { state: 'blocked' }
    }
    ctx.state.patchAnswers({ adminPath })
    const result = applyPlannedWrites(plan.writes)
    if (result.written.length > 0) {
      ctx.logger.success(`wrote ${result.written.length} planned route file(s)`)
    }
    if (result.conflicts.length > 0) {
      ctx.logger.warn('route files changed after preview and were left untouched')
      return { state: 'partial' }
    }
    if (!runtimeRoutesAligned(ctx, adminPath)) {
      ctx.logger.warn(
        `${ctx.resolve(RUNTIME_ROUTES)} requires a manual routes.admin update to ${adminPath}`
      )
      return { state: 'partial' }
    }
    return { state: 'done' }
  },
}

export function buildRoutesPlan(ctx: Context): Plan {
  const adminPath = ctx.state.get().answers.adminPath ?? DEFAULT_ADMIN_PATH
  const slug = pathToSlug(adminPath)
  if (!slug) {
    return {
      writes: [],
      commands: [],
      notes: [
        `invalid admin path "${adminPath}" — must be a single URL segment matching ${ADMIN_SLUG_REGEX}`,
      ],
    }
  }

  const writes = routeWrites(ctx, slug).filter((write) => !existsSync(write.path))
  const notes = [
    `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
    `admin path: ${adminPath}`,
    `${writes.length} route file(s) to create`,
  ]
  const runtime = planRuntimeRoutesWrite(ctx, adminPath)
  if (runtime.write) writes.push(runtime.write)
  if (runtime.note) notes.push(runtime.note)
  return { writes, commands: [], notes }
}

function routeWrites(ctx: Context, slug: string): FileWrite[] {
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  if (!existsSync(templateRoot)) return []
  const targetRoot = ctx.resolve(TARGET_GROUP_DIR)
  return walkFiles(templateRoot).map((abs) => {
    const rel = toPosixTemplatePath(relative(templateRoot, abs))
    const renamed = slug === 'admin' ? rel : renameAdminSegment(rel, slug)
    return {
      path: join(targetRoot, renamed),
      contents: rewriteRouteIds(readFileSync(abs, 'utf8'), slug),
      mode: 'create' as const,
    }
  })
}

function planRuntimeRoutesWrite(
  ctx: Context,
  adminPath: string
): { write?: FileWrite; note?: string } {
  const path = ctx.resolve(RUNTIME_ROUTES)
  if (!existsSync(path)) {
    return { note: `${path}: will be created with the same admin path by scaffold` }
  }
  const before = readFileSync(path, 'utf8')
  const canonical = canonicalRuntimeRoutesSource(ctx)
  if (!canonical) return { note: `${path}: manual — canonical routes.ts template is missing` }
  const desired = replaceAdminPath(canonical, adminPath)
  if (normalizeTemplateSource(before) === normalizeTemplateSource(desired)) return {}
  if (normalizeTemplateSource(before) !== normalizeTemplateSource(canonical)) {
    return {
      note: `${path}: manual — existing user-owned routes.ts does not match the canonical predecessor`,
    }
  }
  const contents = replaceAdminPath(before, adminPath)
  return { write: { path, contents, mode: 'patch', before } }
}

function runtimeRoutesAligned(ctx: Context, adminPath: string): boolean {
  const path = ctx.resolve(RUNTIME_ROUTES)
  if (!existsSync(path)) return true
  const canonical = canonicalRuntimeRoutesSource(ctx)
  if (!canonical) return false
  return (
    normalizeTemplateSource(readFileSync(path, 'utf8')) ===
    normalizeTemplateSource(replaceAdminPath(canonical, adminPath))
  )
}

function canonicalRuntimeRoutesSource(ctx: Context): string | null {
  const examplesPath = join(ctx.templatesDir(), 'byline-examples/routes.ts')
  const basePath = join(ctx.templatesDir(), 'byline/routes.ts')
  const path =
    ctx.state.get().answers.examples !== false && existsSync(examplesPath) ? examplesPath : basePath
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function replaceAdminPath(source: string, adminPath: string): string {
  return source.replace(/(admin\s*:\s*['"])[^'"]+(['"])/, `$1${adminPath}$2`)
}

function pathToSlug(adminPath: string): string | null {
  const trimmed = adminPath.replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed.includes('/')) return null
  return ADMIN_SLUG_REGEX.test(trimmed) ? trimmed : null
}

export function renameAdminSegment(rel: string, slug: string): string {
  rel = toPosixTemplatePath(rel)
  if (rel === 'admin' || rel.startsWith('admin/')) {
    return `${slug}${rel.slice('admin'.length)}`
  }
  return rel
}

function rewriteRouteIds(source: string, slug: string): string {
  if (slug === 'admin') return source
  return source.replace(/(['"])\/_byline\/admin\b/g, `$1/_byline/${slug}`)
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) walk(abs)
      else if (st.isFile()) out.push(abs)
    }
  }
  walk(root)
  return out
}
