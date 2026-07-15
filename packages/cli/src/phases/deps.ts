import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

import { execa } from 'execa'
import { isMap, isScalar, parseDocument } from 'yaml'

import {
  type DependencyCompatibility,
  evaluateDependencyCompatibility,
} from '../lib/dependency-version.js'
import { applyPlannedWrites } from '../lib/planned-writes.js'
import {
  resolveWorkspaceOwnership,
  validateWorkspacePackageManager,
} from '../lib/workspace-root.js'
import { DEP_SPECS, type DepSpec } from '../manifest/deps.js'
import type { Context } from '../context.js'
import type { FileWrite, Phase, Plan, PlanPrecondition, ShellCommand } from '../types.js'

interface DepStatus {
  spec: DepSpec
  presentIn: 'dependencies' | 'devDependencies' | null
  presentVersion: string | null
  compatibility?: DependencyCompatibility
  manual: boolean
}

/**
 * Packages pnpm refuses to build post-install without an explicit opt-in.
 * Each one is either a transitive native binding pulled in by @byline/*
 * (sharp via @byline/core/image, esbuild via Vite, protobufjs via
 * @opentelemetry/*) or an LLM SDK that ships a postinstall (@google/genai
 * via @byline/ai). Without them in the allow list, pnpm pauses the
 * install and asks the user to run `pnpm approve-builds`, which derails
 * the guided installer.
 *
 * Important: pnpm v10+ no longer reads the `pnpm` field from
 * `package.json` and instead expects an `allowBuilds:` map in
 * `pnpm-workspace.yaml` (even for non-monorepo projects). We write there.
 * Older pnpm v9 read `pnpm.onlyBuiltDependencies` in `package.json`; if we
 * find that field we strip it so it doesn't mislead readers.
 */
const PNPM_ALLOWED_BUILDS = ['@google/genai', 'esbuild', 'protobufjs', 'sharp'] as const

export const depsPhase: Phase = {
  id: 'deps',
  title: 'Deps — install required @byline/* and runtime packages',
  defaultMode: 'auto',

  async detect(ctx) {
    if (!validateWorkspacePackageManager(ctx.cwd, ctx.pm).valid) return 'blocked'
    const missing = computeMissing(ctx)
    if (missing === null) return 'blocked'
    const settings = inspectDependencySettings(ctx)
    return missing.length === 0 && settings.complete ? 'done' : 'pending'
  },

  async plan(ctx) {
    const managerValidation = validateWorkspacePackageManager(ctx.cwd, ctx.pm)
    if (!managerValidation.valid) {
      return { writes: [], commands: [], notes: [managerValidation.reason] }
    }
    const missing = computeMissing(ctx)
    if (missing === null) {
      return {
        writes: [],
        commands: [],
        notes: ['package.json not readable — run host phase first'],
      }
    }

    const settings = inspectDependencySettings(ctx)
    const notes: string[] = [...settings.notes]
    const preconditions = dependencyPlanPreconditions(ctx)

    if (missing.length === 0) {
      notes.push('all required dependencies already declared')
      return { writes: settings.writes, commands: [], notes, preconditions }
    }

    const installable = missing.filter((status) => !status.manual)
    const manual = missing.length - installable.length
    if (installable.length > 0)
      notes.push(`${installable.length} package(s) to install via ${ctx.pm}`)
    if (manual > 0) notes.push(`${manual} workspace package(s) require manual compatibility work`)
    for (const { spec, presentVersion, compatibility, manual } of missing) {
      if (manual) {
        notes.push(`  ! ${spec.name}@${presentVersion}: manual — ${compatibility?.reason}`)
        continue
      }
      const action = presentVersion ? `upgrade from ${presentVersion} to` : 'add'
      notes.push(`  + ${spec.name}: ${action} ${spec.version}  (${spec.group}) — ${spec.note}`)
    }
    return {
      writes: settings.writes,
      commands: buildInstallCommands(ctx, installable),
      notes,
      preconditions,
    }
  },

  async apply(plan, ctx) {
    const validation = validateDependencyPlan(plan, ctx)
    if (!validation.valid) {
      ctx.logger.error(`${validation.reason}; dependency plan was not applied`)
      ctx.logger.info('re-run the deps phase to preview current dependency state')
      return { state: 'blocked' }
    }

    const current = computeMissing(ctx)
    if (current === null) return { state: 'blocked' }
    const preservedIssues = current.filter((status) => status.manual)
    if (preservedIssues.length > 0) {
      for (const issue of preservedIssues) {
        ctx.logger.error(
          `${issue.spec.name}@${issue.presentVersion}: ${issue.compatibility?.reason}`
        )
      }
      ctx.logger.info('workspace declarations were preserved; fix the linked package and re-run')
      return { state: 'blocked' }
    }

    const writes = applyPlannedWrites(plan.writes)
    if (writes.conflicts.length > 0) {
      ctx.logger.warn('dependency settings changed after preview and were left untouched')
      return { state: 'blocked' }
    }
    if (writes.written.length > 0) {
      ctx.logger.success(`wrote ${writes.written.length} planned dependency settings file(s)`)
    }

    for (const c of plan.commands) {
      ctx.logger.step(`${c.command} ${c.args.join(' ')}`)
      try {
        await execa(c.command, c.args, { cwd: c.cwd ?? ctx.cwd, stdio: 'inherit' })
      } catch (e) {
        ctx.logger.error(`install failed: ${(e as Error).message}`)
        return { state: 'blocked' }
      }
    }

    const postcondition = validateDependencyPostconditions(ctx)
    if (!postcondition.valid) {
      ctx.logger.error(postcondition.reason)
      return { state: 'blocked' }
    }
    if (plan.commands.length === 0 && plan.writes.length === 0) {
      ctx.logger.info('all required dependencies and settings are already present')
    }
    return { state: 'done' }
  },
}

function computeMissing(ctx: Context): DepStatus[] | null {
  const pkgPath = ctx.resolve('package.json')
  if (!existsSync(pkgPath)) return null
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return null
  }
  const deps = pkg.dependencies ?? {}
  const devDeps = pkg.devDependencies ?? {}

  const answers = ctx.state.get().answers
  const missing: DepStatus[] = []
  for (const spec of DEP_SPECS) {
    if (spec.optional && answers[spec.optional] !== true) continue
    const inDeps = deps[spec.name]
    const inDev = devDeps[spec.name]
    const present = inDeps ?? inDev ?? null
    const compatibility =
      present === null ? undefined : evaluateDependencyCompatibility(ctx, spec, present)
    if (compatibility?.status === 'compatible') continue
    missing.push({
      spec,
      presentIn:
        inDeps !== undefined ? 'dependencies' : inDev !== undefined ? 'devDependencies' : null,
      presentVersion: present,
      compatibility,
      manual: compatibility?.preserveDeclared === true,
    })
  }
  return missing
}

interface HostPackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  pnpm?: { onlyBuiltDependencies?: string[] }
  [key: string]: unknown
}

interface DependencySettingsInspection {
  complete: boolean
  manual: boolean
  writes: FileWrite[]
  notes: string[]
}

function inspectDependencySettings(ctx: Context): DependencySettingsInspection {
  if (ctx.pm !== 'pnpm') return { complete: true, manual: false, writes: [], notes: [] }
  const writes: FileWrite[] = []
  const notes: string[] = []

  const packagePath = ctx.resolve('package.json')
  const packageBefore = existsSync(packagePath) ? readFileSync(packagePath, 'utf8') : null
  if (packageBefore !== null) {
    try {
      const pkg = JSON.parse(packageBefore) as HostPackageJson
      if (pkg.pnpm?.onlyBuiltDependencies !== undefined) {
        const nextPnpm = { ...pkg.pnpm }
        delete nextPnpm.onlyBuiltDependencies
        const next: HostPackageJson = { ...pkg }
        if (Object.keys(nextPnpm).length === 0) delete next.pnpm
        else next.pnpm = nextPnpm
        writes.push({
          path: packagePath,
          contents: `${JSON.stringify(next, null, 2)}\n`,
          mode: 'patch',
          before: packageBefore,
        })
        notes.push('package.json: will remove stale pnpm.onlyBuiltDependencies')
      }
    } catch {
      return {
        complete: false,
        manual: true,
        writes: [],
        notes: ['package.json is not valid JSON'],
      }
    }
  }

  const workspacePath = ctx.resolveWorkspace('pnpm-workspace.yaml')
  const workspaceExists = existsSync(workspacePath)
  const workspaceBefore = workspaceExists ? readFileSync(workspacePath, 'utf8') : ''
  const doc = parseDocument(workspaceBefore)
  if (doc.errors.length > 0) {
    return {
      complete: false,
      manual: true,
      writes,
      notes: [...notes, 'pnpm-workspace.yaml: manual — YAML could not be parsed'],
    }
  }
  const ownership = resolveWorkspaceOwnership(ctx.cwd)
  const packages = (doc.toJS() as { packages?: unknown } | null)?.packages
  if (ownership.kind === 'package-json') {
    if (packages !== undefined && !Array.isArray(packages)) {
      return {
        complete: false,
        manual: true,
        writes,
        notes: [...notes, 'pnpm-workspace.yaml: manual — packages must be an array'],
      }
    }
    if (!Array.isArray(packages) || packages.length === 0) {
      doc.set('packages', ownership.patterns)
      notes.push('pnpm-workspace.yaml: will add package.json workspace patterns')
    }
  }
  const allowBuilds = doc.get('allowBuilds', true)
  if (allowBuilds !== undefined && !isMap(allowBuilds)) {
    return {
      complete: false,
      manual: true,
      writes,
      notes: [...notes, 'pnpm-workspace.yaml: manual — allowBuilds must be a map'],
    }
  }
  const existing = new Set(
    isMap(allowBuilds)
      ? allowBuilds.items
          .filter((item) => isScalar(item.value) && item.value.value === true)
          .map((item) => String(item.key))
      : []
  )
  const missingBuilds = PNPM_ALLOWED_BUILDS.filter((name) => !existing.has(name))
  const packagesChanged =
    ownership.kind === 'package-json' && (!Array.isArray(packages) || packages.length === 0)
  if (missingBuilds.length > 0) {
    if (!doc.has('allowBuilds')) doc.set('allowBuilds', doc.createNode({}))
    for (const name of missingBuilds) doc.setIn(['allowBuilds', name], true)
    writes.push({
      path: workspacePath,
      contents: doc.toString(),
      mode: workspaceExists ? 'patch' : 'create',
      ...(workspaceExists ? { before: workspaceBefore } : {}),
    })
    notes.push(`pnpm-workspace.yaml: will add allowBuilds entries for ${missingBuilds.join(', ')}`)
  } else if (packagesChanged) {
    writes.push({
      path: workspacePath,
      contents: doc.toString(),
      mode: workspaceExists ? 'patch' : 'create',
      ...(workspaceExists ? { before: workspaceBefore } : {}),
    })
  }

  return { complete: writes.length === 0, manual: false, writes, notes }
}

export function validateDependencyPlan(
  plan: Plan,
  ctx: Context
): { valid: true } | { valid: false; reason: string } {
  const managerValidation = validateWorkspacePackageManager(ctx.cwd, ctx.pm)
  if (!managerValidation.valid) return managerValidation
  if (!plan.preconditions) return { valid: false, reason: 'dependency plan has no preconditions' }
  const ownership = resolveWorkspaceOwnership(ctx.cwd)
  for (const precondition of plan.preconditions) {
    if (precondition.type === 'file') {
      const current = existsSync(precondition.path) ? readFileSync(precondition.path, 'utf8') : null
      if (current !== precondition.contents) {
        return { valid: false, reason: `${precondition.path} changed after preview` }
      }
      continue
    }
    if (precondition.type !== 'value') {
      return { valid: false, reason: 'dependency plan has an unsupported precondition' }
    }
    const current =
      precondition.key === 'package-manager'
        ? ctx.pm
        : precondition.key === 'workspace-root'
          ? ownership.root
          : precondition.key === 'workspace-kind'
            ? ownership.kind
            : undefined
    if (current !== precondition.value) {
      return { valid: false, reason: `${precondition.key} changed after preview` }
    }
  }

  const missing = computeMissing(ctx)
  if (missing === null) return { valid: false, reason: 'package.json is unreadable' }
  if (missing.some((status) => status.manual)) {
    return { valid: false, reason: 'workspace dependency compatibility requires manual work' }
  }
  const commands = buildInstallCommands(
    ctx,
    missing.filter((status) => !status.manual)
  )
  if (JSON.stringify(commands) !== JSON.stringify(plan.commands)) {
    return { valid: false, reason: 'dependency install candidates changed after preview' }
  }
  const settings = inspectDependencySettings(ctx)
  if (settings.manual) {
    return { valid: false, reason: 'dependency settings require manual repair' }
  }
  return { valid: true }
}

export function validateDependencyPostconditions(
  ctx: Context
): { valid: true } | { valid: false; reason: string } {
  const missing = computeMissing(ctx)
  if (missing === null) return { valid: false, reason: 'package.json is unreadable after install' }
  if (missing.length > 0) {
    return {
      valid: false,
      reason: `${missing.length} required dependency package(s) remain missing or incompatible`,
    }
  }
  const settings = inspectDependencySettings(ctx)
  if (!settings.complete) {
    return { valid: false, reason: 'required dependency settings remain incomplete' }
  }
  const ownership = resolveWorkspaceOwnership(ctx.cwd)
  if (ownership.root !== ctx.workspaceRoot) {
    return { valid: false, reason: 'workspace root changed after dependency setup' }
  }
  if (ctx.pm === 'pnpm' && ownership.kind !== 'pnpm') {
    return { valid: false, reason: 'pnpm workspace metadata does not own the application' }
  }
  return { valid: true }
}

function dependencyPlanPreconditions(ctx: Context): PlanPrecondition[] {
  const ownership = resolveWorkspaceOwnership(ctx.cwd)
  const paths = new Set([
    ctx.resolve('package.json'),
    ctx.resolveWorkspace('package.json'),
    ctx.resolveWorkspace('pnpm-workspace.yaml'),
    ctx.resolveWorkspace('pnpm-lock.yaml'),
    ctx.resolveWorkspace('yarn.lock'),
    ctx.resolveWorkspace('package-lock.json'),
    ctx.resolveWorkspace('bun.lock'),
    ctx.resolveWorkspace('bun.lockb'),
  ])
  return [
    ...[...paths].map(
      (path): PlanPrecondition => ({
        type: 'file',
        path,
        contents: existsSync(path) ? readFileSync(path, 'utf8') : null,
      })
    ),
    { type: 'value', key: 'package-manager', value: ctx.pm },
    { type: 'value', key: 'workspace-root', value: ownership.root },
    { type: 'value', key: 'workspace-kind', value: ownership.kind },
  ]
}

function buildInstallCommands(ctx: Context, missing: DepStatus[]): ShellCommand[] {
  const runtime = missing
    .filter((m) => m.spec.group !== 'dev')
    .map((m) => `${m.spec.name}@${m.spec.version}`)
  const dev = missing
    .filter((m) => m.spec.group === 'dev')
    .map((m) => `${m.spec.name}@${m.spec.version}`)

  const cmds: ShellCommand[] = []
  if (runtime.length > 0) cmds.push(installCommand(ctx, runtime, false))
  if (dev.length > 0) cmds.push(installCommand(ctx, dev, true))
  return cmds
}

function installCommand(ctx: Context, packages: string[], dev: boolean): ShellCommand {
  const appRelative = relative(ctx.workspaceRoot, ctx.cwd).replaceAll('\\', '/')
  const appSelector = appRelative ? `./${appRelative}` : '.'
  const monorepo = ctx.workspaceRoot !== ctx.cwd
  switch (ctx.pm) {
    case 'pnpm':
      return {
        command: 'pnpm',
        args: [
          ...(monorepo ? ['--filter', appSelector] : []),
          'add',
          ...(!monorepo ? ['-w'] : []),
          ...(dev ? ['-D'] : []),
          ...packages,
        ],
        cwd: ctx.workspaceRoot,
      }
    case 'yarn':
      return monorepo && readAppPackageName(ctx)
        ? {
            command: 'yarn',
            args: [
              'workspace',
              readAppPackageName(ctx) as string,
              'add',
              ...(dev ? ['-D'] : []),
              ...packages,
            ],
            cwd: ctx.workspaceRoot,
          }
        : { command: 'yarn', args: ['add', ...(dev ? ['-D'] : []), ...packages], cwd: ctx.cwd }
    case 'bun':
      return { command: 'bun', args: ['add', ...(dev ? ['-d'] : []), ...packages], cwd: ctx.cwd }
    case 'npm':
      return {
        command: 'npm',
        args: [
          'install',
          ...(monorepo ? ['--workspace', appSelector] : []),
          dev ? '--save-dev' : '--save',
          ...packages,
        ],
        cwd: ctx.workspaceRoot,
      }
  }
}

function readAppPackageName(ctx: Context): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(ctx.resolve('package.json'), 'utf8')) as { name?: string }
    return pkg.name
  } catch {
    return undefined
  }
}
