import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { applyPlannedWrites } from '../lib/planned-writes.js'
import {
  recognizeGeneratedRoutesSource,
  routesSourceAligned,
  validateRoutePaths,
} from '../lib/route-config.js'
import { normalizeTemplateSource, toPosixTemplatePath } from '../lib/template-path.js'
import type { Context } from '../context.js'
import type { FileWrite, Phase, Plan } from '../types.js'

const TARGET_DIR = 'byline'
const BASE_TEMPLATE = 'byline'
const EXAMPLES_TEMPLATE = 'byline-examples'
const GENERATION_SCRIPTS = {
  'byline:generate': 'tsx byline/scripts/generate-types.ts',
  'byline:generate:check': 'tsx byline/scripts/generate-types.ts --check',
} as const

interface TemplateEntry {
  rel: string
  contents: string
}

export const scaffoldPhase: Phase = {
  id: 'scaffold',
  title: 'Scaffold — copy byline/ config tree into the app root',
  defaultMode: 'auto',

  async detect(ctx) {
    const inspection = inspectScaffold(ctx)
    return inspection.complete ? 'done' : 'pending'
  },

  async plan(ctx) {
    return buildScaffoldPlan(ctx)
  },

  async apply(plan, ctx) {
    const answers = ctx.state.get().answers
    const routes = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
    if (!routes.ok) {
      ctx.logger.error(routes.error)
      return { state: 'blocked' }
    }
    ctx.state.patchAnswers({
      adminPath: routes.value.adminPath,
      signInPath: routes.value.signInPath,
    })
    const entries = collectTemplateEntries(
      ctx,
      answers.examples ?? true,
      (answers.examples ?? true) && (answers.importDocs ?? false)
    )
    if (entries.length === 0) {
      ctx.logger.error('no scaffold templates found — was the CLI built with templates?')
      return { state: 'blocked' }
    }
    const result = applyPlannedWrites(plan.writes)
    if (result.written.length > 0) {
      ctx.logger.success(`wrote ${result.written.length} planned scaffold file(s)`)
    }
    if (result.conflicts.length > 0) {
      ctx.logger.warn('files changed after preview and were left untouched:')
      for (const path of result.conflicts) ctx.logger.raw(`    - ${path}`)
      return { state: 'partial' }
    }

    const inspection = inspectScaffold(ctx)
    for (const note of inspection.manualNotes) ctx.logger.warn(note)
    return { state: inspection.complete ? 'done' : 'partial' }
  },
}

export function buildScaffoldPlan(ctx: Context): Plan {
  const answers = ctx.state.get().answers
  const routes = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
  if (!routes.ok) return { writes: [], commands: [], notes: [routes.error] }
  const examples = answers.examples ?? true
  const importDocs = examples && (answers.importDocs ?? false)
  const entries = collectTemplateEntries(ctx, examples, importDocs)
  const writes: FileWrite[] = []
  const notes: string[] = [
    `target: ${ctx.resolve(TARGET_DIR)}/`,
    `examples overlay: ${examples ? 'yes' : 'no'}`,
    `import-docs script: ${importDocs ? 'yes' : 'no'}`,
  ]
  let skipped = 0

  for (const entry of entries) {
    const path = ctx.resolve(TARGET_DIR, entry.rel)
    const expected = transformTemplate(
      entry.rel,
      entry.contents,
      routes.value.adminPath,
      routes.value.signInPath
    )
    if (!existsSync(path)) {
      writes.push({ path, contents: expected, mode: 'create' })
      continue
    }

    const current = readFileSync(path, 'utf8')
    if (
      entry.rel === 'routes.ts' &&
      normalizeTemplateSource(current) !== normalizeTemplateSource(expected)
    ) {
      if (!routesSourceAligned(current, ctx, routes.value)) {
        if (recognizeGeneratedRoutesSource(current, entry.contents)) {
          notes.push(`${path}: generated route migration deferred atomically to the routes phase`)
        } else {
          notes.push(
            `${path}: manual — existing routes.ts is user-owned and does not match a generated predecessor`
          )
        }
      }
    }
    skipped++
  }

  const packageScripts = planGenerationScripts(ctx)
  if (packageScripts.write) writes.push(packageScripts.write)
  notes.push(...packageScripts.notes)
  const turbo = planTurboGenerationCheck(ctx)
  if (turbo.write) writes.push(turbo.write)
  if (turbo.note) notes.push(turbo.note)

  const ci = inspectCiGenerationCheck(ctx)
  if (ci.note) notes.push(ci.note)

  notes.push(`${writes.length} planned write(s), ${skipped} existing scaffold file(s) preserved`)
  if (entries.length === 0)
    notes.push('no template files found — was the CLI built with templates?')
  return { writes, commands: [], notes }
}

function inspectScaffold(ctx: Context): { complete: boolean; manualNotes: string[] } {
  const answers = ctx.state.get().answers
  const routes = validateRoutePaths(ctx, answers.adminPath, answers.signInPath)
  if (!routes.ok) return { complete: false, manualNotes: [routes.error] }
  const entries = collectTemplateEntries(
    ctx,
    answers.examples ?? true,
    (answers.examples ?? true) && (answers.importDocs ?? false)
  )
  if (entries.length === 0) return { complete: false, manualNotes: [] }

  const missing = entries.filter((entry) => !existsSync(ctx.resolve(TARGET_DIR, entry.rel)))
  const manualNotes: string[] = []
  const routeEntry = entries.find((entry) => entry.rel === 'routes.ts')
  if (routeEntry) {
    const path = ctx.resolve(TARGET_DIR, routeEntry.rel)
    if (existsSync(path)) {
      const expected = transformTemplate(
        routeEntry.rel,
        routeEntry.contents,
        routes.value.adminPath,
        routes.value.signInPath
      )
      if (
        normalizeTemplateSource(readFileSync(path, 'utf8')) !== normalizeTemplateSource(expected)
      ) {
        const current = readFileSync(path, 'utf8')
        if (
          !routesSourceAligned(current, ctx, routes.value) &&
          !recognizeGeneratedRoutesSource(current, routeEntry.contents)
        ) {
          manualNotes.push(
            `${path}: manual update required so routes.admin and routes.signIn match ${routes.value.adminPath} and ${routes.value.signInPath}`
          )
        }
      }
    }
  }

  const scriptsComplete = generationScriptsComplete(ctx)
  const packageNotes = planGenerationScripts(ctx).notes
  const turbo = inspectTurboGenerationCheck(ctx)
  const ci = inspectCiGenerationCheck(ctx)
  if (turbo.note) manualNotes.push(turbo.note)
  if (ci.note) manualNotes.push(ci.note)
  manualNotes.push(...packageNotes)
  return {
    complete:
      missing.length === 0 &&
      scriptsComplete &&
      turbo.complete &&
      ci.complete &&
      manualNotes.length === 0,
    manualNotes,
  }
}

function collectTemplateEntries(
  ctx: Context,
  examples: boolean,
  importDocs: boolean
): TemplateEntry[] {
  const baseRoot = join(ctx.templatesDir(), BASE_TEMPLATE)
  const examplesRoot = join(ctx.templatesDir(), EXAMPLES_TEMPLATE)
  const allExamples = examples && existsSync(examplesRoot) ? walkFiles(examplesRoot) : []
  const exampleFiles = allExamples.filter((abs) => {
    return shouldIncludeExampleTemplate(relative(examplesRoot, abs), importDocs)
  })
  const exampleRels = new Set(
    exampleFiles.map((abs) => toPosixTemplatePath(relative(examplesRoot, abs)))
  )
  const entries: TemplateEntry[] = []

  if (existsSync(baseRoot)) {
    for (const abs of walkFiles(baseRoot)) {
      const rel = toPosixTemplatePath(relative(baseRoot, abs))
      if (exampleRels.has(rel)) continue
      entries.push({ rel, contents: readFileSync(abs, 'utf8') })
    }
  }
  for (const abs of exampleFiles) {
    entries.push({
      rel: toPosixTemplatePath(relative(examplesRoot, abs)),
      contents: readFileSync(abs, 'utf8'),
    })
  }
  return entries.sort((a, b) => a.rel.localeCompare(b.rel))
}

export function shouldIncludeExampleTemplate(relativePath: string, importDocs: boolean): boolean {
  const rel = toPosixTemplatePath(relativePath)
  if (rel === 'collections/client-hook-build-boundary.test.node.ts') return true
  if (rel.endsWith('.test.node.ts')) return false
  if (importDocs) return true
  return rel !== 'scripts/import-docs.ts' && !rel.startsWith('scripts/lib/')
}

function transformTemplate(
  rel: string,
  contents: string,
  adminPath: string,
  signInPath: string
): string {
  if (toPosixTemplatePath(rel) !== 'routes.ts') return contents
  return contents
    .replace(/(admin\s*:\s*['"])[^'"]+(['"])/, `$1${adminPath}$2`)
    .replace(/(signIn\s*:\s*['"])[^'"]+(['"])/, `$1${signInPath}$2`)
}

function planGenerationScripts(ctx: Context): { write?: FileWrite; notes: string[] } {
  const path = ctx.resolve('package.json')
  if (!existsSync(path)) return { notes: [`${path}: manual — package.json is missing`] }
  const before = readFileSync(path, 'utf8')
  let pkg: { scripts?: Record<string, string>; [key: string]: unknown }
  try {
    pkg = JSON.parse(before) as typeof pkg
  } catch {
    return { notes: [`${path}: manual — package.json is not valid JSON`] }
  }
  const scripts = { ...(pkg.scripts ?? {}) }
  let changed = false
  const notes: string[] = []
  for (const [name, command] of Object.entries(GENERATION_SCRIPTS)) {
    if (scripts[name] !== undefined) {
      if (scripts[name] !== command) {
        notes.push(`${path}: manual — existing ${name} script differs from the canonical command`)
      }
      continue
    }
    scripts[name] = command
    changed = true
  }
  if (!changed) return { notes }
  return {
    write: {
      path,
      contents: `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`,
      mode: 'patch',
      before,
    },
    notes,
  }
}

function generationScriptsComplete(ctx: Context): boolean {
  try {
    const pkg = JSON.parse(readFileSync(ctx.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    return Object.entries(GENERATION_SCRIPTS).every(
      ([name, command]) => pkg.scripts?.[name] === command
    )
  } catch {
    return false
  }
}

function planTurboGenerationCheck(ctx: Context): { write?: FileWrite; note?: string } {
  const path = ctx.resolveWorkspace('turbo.json')
  if (!existsSync(path)) return {}
  const before = readFileSync(path, 'utf8')
  let config: { tasks?: Record<string, unknown>; [key: string]: unknown }
  try {
    config = JSON.parse(before) as typeof config
  } catch {
    return { note: `${path}: manual — add a byline:generate:check task; config is not plain JSON` }
  }
  if (!config.tasks || typeof config.tasks !== 'object' || Array.isArray(config.tasks)) {
    return { note: `${path}: manual — add a byline:generate:check task under tasks` }
  }
  if (config.tasks['byline:generate:check'] !== undefined) return {}
  const tasks = { ...config.tasks, 'byline:generate:check': { outputs: [] } }
  return {
    write: {
      path,
      contents: `${JSON.stringify({ ...config, tasks }, null, 2)}\n`,
      mode: 'patch',
      before,
    },
  }
}

function inspectTurboGenerationCheck(ctx: Context): { complete: boolean; note?: string } {
  const path = ctx.resolveWorkspace('turbo.json')
  if (!existsSync(path)) return { complete: true }
  let config: { tasks?: Record<string, unknown> }
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as typeof config
  } catch {
    return {
      complete: false,
      note: `${path}: manual — add a byline:generate:check task; config is not plain JSON`,
    }
  }
  if (!config.tasks || typeof config.tasks !== 'object' || Array.isArray(config.tasks)) {
    return {
      complete: false,
      note: `${path}: manual — add a byline:generate:check task under tasks`,
    }
  }
  return { complete: config.tasks['byline:generate:check'] !== undefined }
}

function inspectCiGenerationCheck(ctx: Context): { complete: boolean; note?: string } {
  const path = ctx.resolveWorkspace('.github/workflows/ci.yml')
  if (!existsSync(path)) return { complete: true }
  if (ciIncludesGenerationCheck(readFileSync(path, 'utf8'))) return { complete: true }
  return {
    complete: false,
    note: `${path}: manual — add byline:generate:check to the existing CI workflow; arbitrary CI YAML is never rewritten`,
  }
}

function ciIncludesGenerationCheck(source: string): boolean {
  return source.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('name:') &&
      trimmed.includes('byline:generate:check')
    )
  })
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
