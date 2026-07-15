import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { applyPlannedWrites } from '../lib/planned-writes.js'
import {
  DEFAULT_SIGN_IN_PATH,
  recognizeGeneratedRoutesSource,
  renderGeneratedRoutesSource,
  type ValidatedRoutePaths,
  validateRoutePaths,
} from '../lib/route-config.js'
import { normalizeTemplateSource, toPosixTemplatePath } from '../lib/template-path.js'
import type { Context } from '../context.js'
import type { FileWrite, Phase, Plan, PlanPrecondition } from '../types.js'

const TEMPLATE_DIR = 'routes/_byline'
const TARGET_GROUP_DIR = 'src/routes/_byline'
const RUNTIME_ROUTES = 'byline/routes.ts'
const SIGN_IN_TEMPLATE = 'sign-in.tsx'

interface RuntimeRoutesPlan {
  write?: FileWrite
  note?: string
  previousRoutes?: ValidatedRoutePaths
  migrationBlocked?: boolean
}

export const routesPhase: Phase = {
  id: 'routes',
  title: 'Routes — install the _byline pathless route group',
  defaultMode: 'confirm',

  async detect(ctx) {
    const answers = ctx.state.get().answers
    const validation = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
    if (!validation.ok) return 'pending'
    return inspectRoutes(ctx, validation.value).complete ? 'done' : 'pending'
  },

  async plan(ctx) {
    return buildRoutesPlan(ctx)
  },

  async apply(plan, ctx) {
    const answers = ctx.state.get().answers
    const validation = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
    if (!validation.ok) {
      ctx.logger.error(validation.error)
      return { state: 'blocked' }
    }
    if (expectedRouteWrites(ctx, validation.value).length === 0) {
      ctx.logger.error('no route templates found — was the CLI built with templates?')
      return { state: 'blocked' }
    }
    let stalePreconditionPath: string | undefined
    for (const precondition of plan.preconditions ?? []) {
      if (precondition.type !== 'file') continue
      const current = existsSync(precondition.path) ? readFileSync(precondition.path, 'utf8') : null
      if (current !== precondition.contents) {
        stalePreconditionPath = precondition.path
        break
      }
    }
    if (stalePreconditionPath) {
      ctx.logger.warn(`${stalePreconditionPath} changed after preview; no route changes applied`)
      return { state: 'partial' }
    }
    ctx.state.patchAnswers({
      adminPath: validation.value.adminPath,
      signInPath: validation.value.signInPath,
    })
    const result = applyPlannedWrites(plan.writes)
    if (result.written.length > 0) {
      ctx.logger.success(`wrote ${result.written.length} planned route file(s)`)
    }
    if (result.conflicts.length > 0) {
      ctx.logger.warn('route files changed after preview and were left untouched')
      return { state: 'partial' }
    }
    const inspection = inspectRoutes(ctx, validation.value)
    for (const note of inspection.manualNotes) ctx.logger.warn(note)
    return { state: inspection.complete ? 'done' : 'partial' }
  },
}

export function buildRoutesPlan(ctx: Context): Plan {
  const answers = ctx.state.get().answers
  const validation = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
  if (!validation.ok) return { writes: [], commands: [], notes: [validation.error] }
  const routes = validation.value
  const routeFiles = planRouteFileWrites(ctx, routes)
  const runtime = planRuntimeRoutesWrite(ctx, routes)
  let writes = routeFiles.writes
  const notes = [...routeFiles.notes]

  const previous = runtime.previousRoutes
  const signInMigration = previous && previous.signInPath !== routes.signInPath
  let migrationSafe = !signInMigration
  let oldRouteDelete: FileWrite | undefined
  if (signInMigration) {
    const oldRoute = planGeneratedSignInDelete(ctx, previous)
    migrationSafe = routeFiles.signInReady && oldRoute.safe && runtime.write !== undefined
    if (!migrationSafe) {
      writes = writes.filter((write) => write.path !== routeFiles.signInPath)
      notes.push(
        oldRoute.note ??
          `${ctx.resolve(RUNTIME_ROUTES)}: manual — sign-in migration was left unchanged because every step was not recognized as generated and safe`
      )
    } else {
      oldRouteDelete = oldRoute.write
    }
  }
  if (runtime.migrationBlocked) {
    writes = writes.filter((write) => write.path !== routeFiles.signInPath)
  }
  const defaultSignInPath = ctx.resolve(TARGET_GROUP_DIR, SIGN_IN_TEMPLATE)
  if (
    !signInMigration &&
    routeFiles.signInPath !== defaultSignInPath &&
    existsSync(defaultSignInPath)
  ) {
    notes.push(`${defaultSignInPath}: manual — existing sign-in route was preserved`)
  }

  if (runtime.write && migrationSafe) {
    writes.push(runtime.write)
  }
  if (oldRouteDelete) writes.push(oldRouteDelete)
  if (runtime.note) notes.push(runtime.note)

  const planNotes = [
    `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
    `admin path: ${routes.adminPath}`,
    `sign-in path: ${routes.signInPath}`,
    `${writes.length} planned route/config change(s)`,
    ...notes,
  ]
  const preconditions =
    signInMigration && migrationSafe && routeFiles.signInPrecondition
      ? [routeFiles.signInPrecondition]
      : undefined
  return { writes, commands: [], notes: planNotes, preconditions }
}

function expectedRouteWrites(ctx: Context, routes: ValidatedRoutePaths): FileWrite[] {
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  if (!existsSync(templateRoot)) return []
  const targetRoot = ctx.resolve(TARGET_GROUP_DIR)
  return walkFiles(templateRoot).map((abs) => {
    const rel = toPosixTemplatePath(relative(templateRoot, abs))
    const renamed =
      rel === SIGN_IN_TEMPLATE
        ? `${routes.signInSegments.join('/')}.tsx`
        : renameAdminSegment(rel, routes.adminSlug)
    return {
      path: join(targetRoot, renamed),
      contents: rewriteRouteIds(readFileSync(abs, 'utf8'), routes),
      mode: 'create' as const,
    }
  })
}

function planRouteFileWrites(
  ctx: Context,
  routes: ValidatedRoutePaths
): {
  writes: FileWrite[]
  notes: string[]
  signInPath: string
  signInReady: boolean
  signInPrecondition?: PlanPrecondition
} {
  const writes: FileWrite[] = []
  const notes: string[] = []
  const signInPath = signInRouteFilePath(ctx, routes)
  let signInReady = false
  let signInPrecondition: PlanPrecondition | undefined
  for (const expected of expectedRouteWrites(ctx, routes)) {
    if (!existsSync(expected.path)) {
      writes.push(expected)
      if (expected.path === signInPath) signInReady = true
    } else if (
      normalizeTemplateSource(readFileSync(expected.path, 'utf8')) !==
      normalizeTemplateSource(expected.contents)
    ) {
      notes.push(`${expected.path}: manual — existing route file differs from the template`)
    } else if (expected.path === signInPath) {
      signInReady = true
      signInPrecondition = {
        type: 'file',
        path: expected.path,
        contents: readFileSync(expected.path, 'utf8'),
      }
    }
  }
  return { writes, notes, signInPath, signInReady, signInPrecondition }
}

function planRuntimeRoutesWrite(ctx: Context, routes: ValidatedRoutePaths): RuntimeRoutesPlan {
  const path = ctx.resolve(RUNTIME_ROUTES)
  const canonical = canonicalRuntimeRoutesSource(ctx)
  if (!canonical) return { note: `${path}: manual — canonical routes.ts template is missing` }
  const desired = renderGeneratedRoutesSource(canonical, routes.adminPath, routes.signInPath)
  if (!existsSync(path)) return { write: { path, contents: desired, mode: 'create' } }
  const before = readFileSync(path, 'utf8')
  if (normalizeTemplateSource(before) === normalizeTemplateSource(desired)) return {}
  const generated = recognizeGeneratedRoutesSource(before, canonical)
  if (!generated) {
    return {
      note: `${path}: manual — existing user-owned routes.ts does not match a generated predecessor`,
      migrationBlocked: true,
    }
  }
  const previous = validateRoutePaths(
    ctx,
    generated.adminPath,
    generated.signInPath ?? DEFAULT_SIGN_IN_PATH
  )
  if (!previous.ok) {
    return {
      note: `${path}: manual — generated predecessor has invalid route paths`,
      migrationBlocked: true,
    }
  }
  return {
    write: { path, contents: desired, mode: 'patch', before },
    previousRoutes: previous.value,
  }
}

function runtimeRoutesAligned(ctx: Context, routes: ValidatedRoutePaths): boolean {
  const path = ctx.resolve(RUNTIME_ROUTES)
  if (!existsSync(path)) return false
  const canonical = canonicalRuntimeRoutesSource(ctx)
  if (!canonical) return false
  return (
    normalizeTemplateSource(readFileSync(path, 'utf8')) ===
    normalizeTemplateSource(
      renderGeneratedRoutesSource(canonical, routes.adminPath, routes.signInPath)
    )
  )
}

function canonicalRuntimeRoutesSource(ctx: Context): string | null {
  const examplesPath = join(ctx.templatesDir(), 'byline-examples/routes.ts')
  const basePath = join(ctx.templatesDir(), 'byline/routes.ts')
  const path =
    ctx.state.get().answers.examples !== false && existsSync(examplesPath) ? examplesPath : basePath
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function inspectRoutes(
  ctx: Context,
  routes: ValidatedRoutePaths
): { complete: boolean; manualNotes: string[] } {
  const expected = expectedRouteWrites(ctx, routes)
  if (expected.length === 0) {
    return { complete: false, manualNotes: ['no route templates found'] }
  }
  const manualNotes: string[] = []
  for (const route of expected) {
    if (!existsSync(route.path)) {
      manualNotes.push(`${route.path}: missing generated route`)
    } else if (
      normalizeTemplateSource(readFileSync(route.path, 'utf8')) !==
      normalizeTemplateSource(route.contents)
    ) {
      manualNotes.push(`${route.path}: manual — existing route file differs from the template`)
    }
  }
  for (const generated of findGeneratedSignInRoutes(ctx)) {
    if (generated.routePath !== routes.signInPath) {
      manualNotes.push(`${generated.filePath}: manual — old generated sign-in route still exists`)
    }
  }
  const defaultSignInPath = ctx.resolve(TARGET_GROUP_DIR, SIGN_IN_TEMPLATE)
  if (routes.signInPath !== DEFAULT_SIGN_IN_PATH && existsSync(defaultSignInPath)) {
    manualNotes.push(`${defaultSignInPath}: manual — existing sign-in route still exists`)
  }
  if (!runtimeRoutesAligned(ctx, routes)) {
    manualNotes.push(
      `${ctx.resolve(RUNTIME_ROUTES)}: manual — routes.admin and routes.signIn must match ${routes.adminPath} and ${routes.signInPath}`
    )
  }
  return { complete: manualNotes.length === 0, manualNotes }
}

function planGeneratedSignInDelete(
  ctx: Context,
  previous: ValidatedRoutePaths
): { safe: boolean; write?: FileWrite; note?: string } {
  const path = signInRouteFilePath(ctx, previous)
  if (!existsSync(path)) return { safe: true }
  const before = readFileSync(path, 'utf8')
  const expected = expectedSignInRouteSource(ctx, previous.signInPath)
  if (expected === null || normalizeTemplateSource(before) !== normalizeTemplateSource(expected)) {
    return {
      safe: false,
      note: `${path}: manual — existing sign-in route is user-owned; config and route were left unchanged`,
    }
  }
  return { safe: true, write: { path, contents: '', mode: 'delete', before } }
}

function signInRouteFilePath(ctx: Context, routes: ValidatedRoutePaths): string {
  return ctx.resolve(TARGET_GROUP_DIR, `${routes.signInSegments.join('/')}.tsx`)
}

function expectedSignInRouteSource(ctx: Context, signInPath: string): string | null {
  const templatePath = join(ctx.templatesDir(), TEMPLATE_DIR, SIGN_IN_TEMPLATE)
  if (!existsSync(templatePath)) return null
  return readFileSync(templatePath, 'utf8').replace(
    /(['"])\/_byline\/sign-in\b/g,
    `$1/_byline${signInPath}`
  )
}

function findGeneratedSignInRoutes(ctx: Context): Array<{ filePath: string; routePath: string }> {
  const root = ctx.resolve(TARGET_GROUP_DIR)
  if (!existsSync(root)) return []
  const generated: Array<{ filePath: string; routePath: string }> = []
  for (const filePath of walkFiles(root)) {
    if (!filePath.endsWith('.tsx')) continue
    const routePath = `/${toPosixTemplatePath(relative(root, filePath)).replace(/\.tsx$/, '')}`
    const expected = expectedSignInRouteSource(ctx, routePath)
    if (
      expected !== null &&
      normalizeTemplateSource(readFileSync(filePath, 'utf8')) === normalizeTemplateSource(expected)
    ) {
      generated.push({ filePath, routePath })
    }
  }
  return generated
}

export function renameAdminSegment(rel: string, slug: string): string {
  rel = toPosixTemplatePath(rel)
  if (rel === 'admin' || rel.startsWith('admin/')) {
    return `${slug}${rel.slice('admin'.length)}`
  }
  return rel
}

function rewriteRouteIds(source: string, routes: ValidatedRoutePaths): string {
  return source
    .replace(/(['"])\/_byline\/admin\b/g, `$1/_byline/${routes.adminSlug}`)
    .replace(/(['"])\/_byline\/sign-in\b/g, `$1/_byline${routes.signInPath}`)
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
