import { existsSync, lstatSync, readdirSync, readFileSync, rmdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { applyPlannedWrites } from '../lib/planned-writes.js'
import {
  canonicalRoutesTemplatePath,
  DEFAULT_SIGN_IN_PATH,
  readStaticRoutesSource,
  recognizeGeneratedRoutesSource,
  renderGeneratedRoutesSource,
  routesSourceAligned,
  type ValidatedRoutePaths,
  validateCanonicalRoutesSource,
  validateRoutePaths,
} from '../lib/route-config.js'
import { normalizeTemplateSource, toPosixTemplatePath } from '../lib/template-path.js'
import type { Context } from '../context.js'
import type { FileWrite, Phase, Plan, PlanPrecondition, TreeSnapshotEntry } from '../types.js'

const TEMPLATE_DIR = 'routes/_byline'
const TARGET_GROUP_DIR = 'src/routes/_byline'
const RUNTIME_ROUTES = 'byline/routes.ts'
const SIGN_IN_TEMPLATE = 'sign-in.tsx'

interface RuntimeRoutesPlan {
  write?: FileWrite
  note?: string
  previousRoutes?: ValidatedRoutePaths
  migrationBlocked?: boolean
  precondition?: PlanPrecondition
}

interface ExpectedRouteFile extends FileWrite {
  rel: string
  kind: 'admin' | 'shared' | 'signIn'
}

interface GeneratedMigrationPlan {
  safe: boolean
  writes: FileWrite[]
  preconditions: PlanPrecondition[]
  note?: string
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
    const canonical = canonicalRuntimeRoutesSource(ctx)
    if (!canonical.ok) {
      ctx.logger.error(canonical.error)
      return { state: 'blocked' }
    }
    if (expectedRouteWrites(ctx, validation.value).length === 0) {
      ctx.logger.error('no route templates found — was the CLI built with templates?')
      return { state: 'blocked' }
    }
    let stalePreconditionPath: string | undefined
    for (const precondition of plan.preconditions ?? []) {
      if (precondition.type === 'value') continue
      const stale =
        precondition.type === 'file'
          ? currentFileContents(precondition.path) !== precondition.contents
          : !treeSnapshotsEqual(snapshotTree(precondition.path), precondition.entries)
      if (stale) {
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
    removeEmptyDeletedRouteDirectories(plan.writes, ctx.resolve(TARGET_GROUP_DIR))
    const migrationResiduals = findMigrationResiduals(plan, ctx, validation.value)
    for (const path of migrationResiduals) {
      ctx.logger.warn(`${path}: manual — residual file remains in the old admin tree`)
    }
    const inspection = inspectRoutes(ctx, validation.value)
    for (const note of inspection.manualNotes) ctx.logger.warn(note)
    return { state: inspection.complete && migrationResiduals.length === 0 ? 'done' : 'partial' }
  },
}

export function buildRoutesPlan(ctx: Context): Plan {
  const answers = ctx.state.get().answers
  const validation = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
  if (!validation.ok) return { writes: [], commands: [], notes: [validation.error] }
  const routes = validation.value
  const canonical = canonicalRuntimeRoutesSource(ctx)
  if (!canonical.ok) return { writes: [], commands: [], notes: [canonical.error] }
  if (expectedRouteWrites(ctx, routes).length === 0) {
    return {
      writes: [],
      commands: [],
      notes: ['no route templates found — was the CLI built with templates?'],
    }
  }
  const routeFiles = planRouteFileWrites(ctx, routes)
  if (routeFiles.blocked) {
    return {
      writes: [],
      commands: [],
      notes: [
        `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
        `admin path: ${routes.adminPath}`,
        `sign-in path: ${routes.signInPath}`,
        '0 planned route/config change(s)',
        ...routeFiles.notes,
      ],
    }
  }
  const runtime = planRuntimeRoutesWrite(ctx, routes, canonical.source)
  let writes = routeFiles.writes
  const notes = [...routeFiles.notes]

  if (runtime.migrationBlocked) {
    if (runtime.note) notes.push(runtime.note)
    return {
      writes: [],
      commands: [],
      notes: [
        `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
        `admin path: ${routes.adminPath}`,
        `sign-in path: ${routes.signInPath}`,
        '0 planned route/config change(s)',
        ...notes,
      ],
    }
  }

  const previous = runtime.previousRoutes
  const generatedMigration =
    previous &&
    (previous.adminPath !== routes.adminPath || previous.signInPath !== routes.signInPath)
      ? planGeneratedRoutesMigration(ctx, previous, routes)
      : undefined
  if (generatedMigration && (!generatedMigration.safe || runtime.write === undefined)) {
    return {
      writes: [],
      commands: [],
      notes: [
        `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
        `admin path: ${routes.adminPath}`,
        `sign-in path: ${routes.signInPath}`,
        '0 planned route/config change(s)',
        generatedMigration.note ??
          `${ctx.resolve(RUNTIME_ROUTES)}: manual — route migration was left unchanged because every coupled file was not recognized as generated and safe`,
      ],
    }
  }

  if (generatedMigration) writes = generatedMigration.writes
  const defaultSignInPath = ctx.resolve(TARGET_GROUP_DIR, SIGN_IN_TEMPLATE)
  if (
    !generatedMigration &&
    routeFiles.signInPath !== defaultSignInPath &&
    existsSync(defaultSignInPath)
  ) {
    notes.push(`${defaultSignInPath}: manual — existing sign-in route was preserved`)
  }

  if (runtime.write) writes.push(runtime.write)
  if (generatedMigration) {
    const deletes = writes.filter((write) => write.mode === 'delete')
    writes = [...writes.filter((write) => write.mode !== 'delete'), ...deletes]
  }
  if (runtime.note) notes.push(runtime.note)

  const planNotes = [
    `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
    `admin path: ${routes.adminPath}`,
    `sign-in path: ${routes.signInPath}`,
    `${writes.length} planned route/config change(s)`,
    ...notes,
  ]
  const preconditions = [
    { type: 'file' as const, path: canonical.path, contents: canonical.source },
    ...(runtime.precondition ? [runtime.precondition] : []),
    ...(generatedMigration?.preconditions ?? []),
  ]
  return { writes, commands: [], notes: planNotes, preconditions }
}

function expectedRouteWrites(ctx: Context, routes: ValidatedRoutePaths): ExpectedRouteFile[] {
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  if (!existsSync(templateRoot)) return []
  const targetRoot = ctx.resolve(TARGET_GROUP_DIR)
  return walkFiles(templateRoot).map((abs) => {
    const rel = toPosixTemplatePath(relative(templateRoot, abs))
    const kind = rel === SIGN_IN_TEMPLATE ? 'signIn' : rel.startsWith('admin/') ? 'admin' : 'shared'
    const renamed =
      rel === SIGN_IN_TEMPLATE
        ? `${routes.signInSegments.join('/')}.tsx`
        : renameAdminSegment(rel, routes.adminSegments)
    return {
      rel,
      kind,
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
  blocked: boolean
} {
  const writes: FileWrite[] = []
  const notes: string[] = []
  const signInPath = signInRouteFilePath(ctx, routes)
  for (const expected of expectedRouteWrites(ctx, routes)) {
    const invalidParent = firstInvalidParent(expected.path)
    if (invalidParent) {
      return {
        writes: [],
        notes: [
          `${expected.path}: manual — expected route target has a non-directory parent at ${invalidParent}`,
        ],
        signInPath,
        blocked: true,
      }
    }
    const target = lstatIfPresent(expected.path)
    if (!target) {
      writes.push(expected)
    } else if (!target.isFile()) {
      return {
        writes: [],
        notes: [`${expected.path}: manual — expected route target is not a regular file`],
        signInPath,
        blocked: true,
      }
    } else if (
      normalizeTemplateSource(readFileSync(expected.path, 'utf8')) !==
      normalizeTemplateSource(expected.contents)
    ) {
      notes.push(`${expected.path}: manual — existing route file differs from the template`)
    }
  }
  return { writes, notes, signInPath, blocked: false }
}

function planRuntimeRoutesWrite(
  ctx: Context,
  routes: ValidatedRoutePaths,
  canonical: string
): RuntimeRoutesPlan {
  const path = ctx.resolve(RUNTIME_ROUTES)
  const desired = renderGeneratedRoutesSource(
    canonical,
    routes.adminPath,
    routes.apiPath,
    routes.signInPath
  )
  const invalidParent = firstInvalidParent(path)
  if (invalidParent) {
    return {
      note: `${path}: manual — routes.ts target has a non-directory parent at ${invalidParent}`,
      migrationBlocked: true,
    }
  }
  const target = lstatIfPresent(path)
  if (!target) return { write: { path, contents: desired, mode: 'create' } }
  if (!target.isFile()) {
    return {
      note: `${path}: manual — routes.ts target is not a regular file`,
      migrationBlocked: true,
    }
  }
  const before = readFileSync(path, 'utf8')
  const staticRoutes = readStaticRoutesSource(before)
  if (!staticRoutes.ok) {
    return {
      note: `${path}: manual — existing routes.ts cannot be resolved statically`,
      migrationBlocked: true,
    }
  }
  const previous = validateRoutePaths(
    ctx,
    staticRoutes.value.admin,
    staticRoutes.value.signIn,
    staticRoutes.value.api
  )
  if (!previous.ok) {
    return {
      note: `${path}: manual — existing routes.ts has invalid route paths`,
      migrationBlocked: true,
    }
  }
  const generated = recognizeGeneratedRoutesSource(before, canonical)
  if (generated) {
    const generatedPrevious = validateRoutePaths(
      ctx,
      generated.adminPath,
      generated.signInPath,
      generated.apiPath
    )
    if (!generatedPrevious.ok) {
      return {
        note: `${path}: manual — generated predecessor has invalid route paths`,
        migrationBlocked: true,
      }
    }
    if (normalizeTemplateSource(before) === normalizeTemplateSource(desired)) {
      return { precondition: { type: 'file', path, contents: before } }
    }
    return {
      write: { path, contents: desired, mode: 'patch', before },
      previousRoutes: generatedPrevious.value,
    }
  }
  if (
    previous.value.adminPath === routes.adminPath &&
    previous.value.apiPath === routes.apiPath &&
    previous.value.signInPath === routes.signInPath
  ) {
    return { precondition: { type: 'file', path, contents: before } }
  }
  return {
    note: `${path}: manual — existing user-owned routes.ts does not match a generated predecessor`,
    migrationBlocked: true,
  }
}

function runtimeRoutesAligned(ctx: Context, routes: ValidatedRoutePaths): boolean {
  const path = ctx.resolve(RUNTIME_ROUTES)
  if (firstInvalidParent(path)) return false
  if (!lstatIfPresent(path)?.isFile()) return false
  return routesSourceAligned(readFileSync(path, 'utf8'), ctx, routes)
}

function canonicalRuntimeRoutesSource(
  ctx: Context
): { ok: true; path: string; source: string } | { ok: false; error: string } {
  const path = canonicalRoutesTemplatePath(ctx)
  if (!existsSync(path)) {
    return { ok: false, error: `${path}: manual — canonical routes.ts template is missing` }
  }
  const source = readFileSync(path, 'utf8')
  const validation = validateCanonicalRoutesSource(source)
  return validation.ok
    ? { ok: true, path, source }
    : {
        ok: false,
        error: `${path}: manual — canonical routes.ts template is invalid (${validation.error})`,
      }
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
    const invalidParent = firstInvalidParent(route.path)
    if (invalidParent) {
      manualNotes.push(
        `${route.path}: manual — expected route target has a non-directory parent at ${invalidParent}`
      )
      continue
    }
    const target = lstatIfPresent(route.path)
    if (!target) {
      manualNotes.push(`${route.path}: missing generated route`)
    } else if (!target.isFile()) {
      manualNotes.push(`${route.path}: manual — expected route target is not a regular file`)
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
  for (const generated of findGeneratedAdminRoutes(ctx, routes)) {
    if (generated.adminPath !== routes.adminPath) {
      manualNotes.push(`${generated.filePath}: manual — old generated admin tree still exists`)
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

function planGeneratedRoutesMigration(
  ctx: Context,
  previous: ValidatedRoutePaths,
  desired: ValidatedRoutePaths
): GeneratedMigrationPlan {
  const previousFiles = expectedRouteWrites(ctx, previous)
  const desiredFiles = expectedRouteWrites(ctx, desired)
  const previousByPath = new Map(previousFiles.map((file) => [file.path, file]))
  const desiredByPath = new Map(desiredFiles.map((file) => [file.path, file]))
  const writes: FileWrite[] = []
  const preconditions: PlanPrecondition[] = []
  const oldAdminPaths = new Set(
    previousFiles.filter((file) => file.kind === 'admin').map((file) => file.path)
  )

  for (const old of previousFiles) {
    const invalidParent = firstInvalidParent(old.path)
    if (invalidParent) {
      return migrationFailure(old.path, `old route has a non-directory parent at ${invalidParent}`)
    }
    const target = lstatIfPresent(old.path)
    if (!target) continue
    if (!target.isFile()) {
      return migrationFailure(old.path, 'existing old route target is not a regular file')
    }
    const before = readFileSync(old.path, 'utf8')
    const next = desiredByPath.get(old.path)
    const matchesOld = sourcesEqual(before, old.contents)
    const matchesDesired = next !== undefined && sourcesEqual(before, next.contents)
    if (!matchesOld && !matchesDesired) {
      const label = old.kind === 'signIn' ? 'sign-in route' : `${old.kind} route file`
      return migrationFailure(old.path, `existing old ${label} is user-owned`)
    }
  }

  for (const next of desiredFiles) {
    const invalidParent = firstInvalidParent(next.path)
    if (invalidParent) {
      return migrationFailure(
        next.path,
        `migration destination has a non-directory parent at ${invalidParent}`
      )
    }
    const target = lstatIfPresent(next.path)
    if (!target) {
      writes.push(next)
      continue
    }
    if (!target.isFile()) {
      return migrationFailure(next.path, 'migration destination is not a regular file')
    }
    const before = readFileSync(next.path, 'utf8')
    if (sourcesEqual(before, next.contents)) {
      preconditions.push({ type: 'file', path: next.path, contents: before })
      continue
    }
    const oldAtDestination = previousByPath.get(next.path)
    if (oldAtDestination && sourcesEqual(before, oldAtDestination.contents)) {
      writes.push({ path: next.path, contents: next.contents, mode: 'patch', before })
      continue
    }
    return migrationFailure(next.path, 'migration destination is user-owned')
  }

  for (const old of previousFiles) {
    if (desiredByPath.has(old.path) || !existsSync(old.path)) continue
    const before = readFileSync(old.path, 'utf8')
    writes.push({ path: old.path, contents: '', mode: 'delete', before })
  }

  if (previous.adminPath !== desired.adminPath) {
    const oldRoot = ctx.resolve(TARGET_GROUP_DIR, ...previous.adminSegments)
    const oldTree = snapshotTree(oldRoot)
    if (oldTree.length > 0) {
      if (oldTree[0]?.type !== 'directory') {
        return migrationFailure(oldRoot, 'old admin tree root is user-owned')
      }
      const allowedPaths = new Set([
        ...oldAdminPaths,
        ...desiredFiles.filter((file) => file.kind === 'admin').map((file) => file.path),
      ])
      for (const entry of oldTree) {
        if (entry.path === oldRoot) continue
        if (entry.type === 'directory' && isManagedDirectory(entry.path, allowedPaths)) continue
        if (entry.type === 'file' && oldAdminPaths.has(entry.path)) continue
        const next = desiredByPath.get(entry.path)
        if (entry.type === 'file' && next && sourcesEqual(entry.contents ?? '', next.contents)) {
          continue
        }
        return migrationFailure(entry.path, 'old admin tree contains a user-owned file')
      }
    }
    preconditions.push({ type: 'tree', path: oldRoot, entries: oldTree })
  }

  return { safe: true, writes, preconditions }
}

function sourcesEqual(left: string, right: string): boolean {
  return normalizeTemplateSource(left) === normalizeTemplateSource(right)
}

function migrationFailure(path: string, reason: string): GeneratedMigrationPlan {
  return {
    safe: false,
    writes: [],
    preconditions: [],
    note: `${path}: manual — ${reason}; no coupled route changes were planned`,
  }
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

function findGeneratedAdminRoutes(
  ctx: Context,
  routes: ValidatedRoutePaths
): Array<{ filePath: string; adminPath: string }> {
  const root = ctx.resolve(TARGET_GROUP_DIR)
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  const adminTemplateRoot = join(templateRoot, 'admin')
  if (!existsSync(root) || !existsSync(adminTemplateRoot)) return []
  const adminTemplates = walkFiles(adminTemplateRoot).map((templatePath) => ({
    templatePath,
    suffix: toPosixTemplatePath(relative(adminTemplateRoot, templatePath)),
  }))
  const generated: Array<{ filePath: string; adminPath: string }> = []

  for (const filePath of walkFiles(root)) {
    const rel = toPosixTemplatePath(relative(root, filePath))
    for (const template of adminTemplates) {
      if (rel !== template.suffix && !rel.endsWith(`/${template.suffix}`)) continue
      const prefixLength = rel.length - template.suffix.length
      const adminRel = rel.slice(0, prefixLength).replace(/\/$/, '')
      if (!adminRel) continue
      const adminSegments = adminRel.split('/')
      const candidate = {
        ...routes,
        adminPath: `/${adminRel}`,
        adminSegments,
      }
      const expected = rewriteRouteIds(readFileSync(template.templatePath, 'utf8'), candidate)
      if (
        normalizeTemplateSource(readFileSync(filePath, 'utf8')) ===
        normalizeTemplateSource(expected)
      ) {
        generated.push({ filePath, adminPath: candidate.adminPath })
        break
      }
    }
  }
  return generated
}

export function renameAdminSegment(rel: string, segments: readonly string[]): string {
  rel = toPosixTemplatePath(rel)
  if (rel === 'admin' || rel.startsWith('admin/')) {
    return `${segments.join('/')}${rel.slice('admin'.length)}`
  }
  return rel
}

function rewriteRouteIds(source: string, routes: ValidatedRoutePaths): string {
  return source
    .replace(/(['"])\/_byline\/admin\b/g, `$1/_byline${routes.adminPath}`)
    .replace(/(['"])\/_byline\/sign-in\b/g, `$1/_byline${routes.signInPath}`)
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  if (!lstatIfPresent(root)?.isDirectory()) return out
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const st = lstatSync(abs)
      if (st.isDirectory()) walk(abs)
      else if (st.isFile()) out.push(abs)
    }
  }
  walk(root)
  return out
}

function snapshotTree(root: string): TreeSnapshotEntry[] {
  if (!lstatIfPresent(root)) return []
  const entries: TreeSnapshotEntry[] = []

  function walk(path: string): void {
    const stat = lstatSync(path)
    if (stat.isDirectory()) {
      entries.push({ path, type: 'directory' })
      for (const name of readdirSync(path).sort()) walk(join(path, name))
      return
    }
    if (stat.isFile()) {
      entries.push({ path, type: 'file', contents: readFileSync(path, 'utf8') })
      return
    }
    entries.push({ path, type: 'other' })
  }

  walk(root)
  return entries
}

function treeSnapshotsEqual(
  left: readonly TreeSnapshotEntry[],
  right: readonly TreeSnapshotEntry[]
): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, index) => {
    const expected = right[index]
    return (
      expected !== undefined &&
      entry.path === expected.path &&
      entry.type === expected.type &&
      entry.contents === expected.contents
    )
  })
}

function currentFileContents(path: string): string | null | undefined {
  const target = lstatIfPresent(path)
  if (!target) return null
  return target.isFile() ? readFileSync(path, 'utf8') : undefined
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

function firstInvalidParent(path: string): string | undefined {
  let parent = dirname(path)
  while (true) {
    const target = lstatIfPresent(parent)
    if (target) return target.isDirectory() ? undefined : parent
    const next = dirname(parent)
    if (next === parent) return parent
    parent = next
  }
}

function isManagedDirectory(path: string, managedFiles: ReadonlySet<string>): boolean {
  return [...managedFiles].some((file) => isPathWithin(path, file))
}

function isPathWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\')
}

function findMigrationResiduals(plan: Plan, ctx: Context, routes: ValidatedRoutePaths): string[] {
  const oldTrees = (plan.preconditions ?? []).filter(
    (precondition): precondition is Extract<PlanPrecondition, { type: 'tree' }> =>
      precondition.type === 'tree'
  )
  if (oldTrees.length === 0) return []

  const desiredAdminPaths = new Set(
    expectedRouteWrites(ctx, routes)
      .filter((file) => file.kind === 'admin')
      .map((file) => file.path)
  )
  const residuals: string[] = []
  for (const tree of oldTrees) {
    for (const entry of snapshotTree(tree.path)) {
      if (entry.path === tree.path) continue
      if (entry.type === 'directory' && isManagedDirectory(entry.path, desiredAdminPaths)) continue
      if (entry.type === 'file' && desiredAdminPaths.has(entry.path)) continue
      residuals.push(entry.path)
    }
  }
  return residuals
}

function removeEmptyDeletedRouteDirectories(writes: readonly FileWrite[], root: string): void {
  for (const write of writes) {
    if (write.mode !== 'delete') continue
    let directory = dirname(write.path)
    while (directory !== root && directory.startsWith(`${root}/`) && existsSync(directory)) {
      if (readdirSync(directory).length > 0) break
      try {
        rmdirSync(directory)
      } catch {
        break
      }
      directory = dirname(directory)
    }
  }
}
