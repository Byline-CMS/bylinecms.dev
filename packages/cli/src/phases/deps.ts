import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { execa } from 'execa'

import { DEP_SPECS, type DepSpec } from '../manifest/deps.js'
import type { Context } from '../context.js'
import type { PackageManager, Phase, ShellCommand } from '../types.js'

interface DepStatus {
  spec: DepSpec
  presentIn: 'dependencies' | 'devDependencies' | null
  presentVersion: string | null
}

/**
 * Packages pnpm refuses to build post-install without an explicit opt-in
 * via `pnpm.onlyBuiltDependencies`. Each one is either a transitive native
 * binding pulled in by @byline/* (sharp via @byline/core/image, esbuild
 * via Vite, protobufjs via @opentelemetry/*) or an LLM SDK that ships a
 * postinstall (@google/genai via @byline/ai). Without them in the allow
 * list, pnpm pauses the install and asks the user to run
 * `pnpm approve-builds` — which derails the guided installer. We prepend
 * them to the host package.json before running `pnpm add`.
 */
const PNPM_ALLOWED_BUILDS = ['@google/genai', 'esbuild', 'protobufjs', 'sharp'] as const

export const depsPhase: Phase = {
  id: 'deps',
  title: 'Deps — install required @byline/* and runtime packages',
  defaultMode: 'auto',

  async detect(ctx) {
    if (ctx.state.isComplete('deps')) return 'done'
    const missing = computeMissing(ctx)
    if (missing === null) return 'blocked'
    return missing.length === 0 ? 'done' : 'pending'
  },

  async plan(ctx) {
    const missing = computeMissing(ctx)
    if (missing === null) {
      return {
        writes: [],
        commands: [],
        notes: ['package.json not readable — run host phase first'],
      }
    }

    const notes: string[] = []
    if (ctx.pm === 'pnpm') {
      const missingBuilds = computeMissingPnpmBuilds(ctx)
      if (missingBuilds && missingBuilds.length > 0) {
        notes.push(
          `pnpm.onlyBuiltDependencies: will add ${missingBuilds.join(', ')} to package.json (so pnpm doesn't pause the install)`
        )
      }
    }

    if (missing.length === 0) {
      notes.push('all required dependencies already declared')
      return { writes: [], commands: [], notes }
    }

    notes.push(`${missing.length} package(s) to install via ${ctx.pm}`)
    for (const { spec } of missing) {
      notes.push(`  + ${spec.name}@${spec.version}  (${spec.group}) — ${spec.note}`)
    }
    return { writes: [], commands: buildInstallCommands(ctx.pm, missing), notes }
  },

  async apply(_plan, ctx) {
    const missing = computeMissing(ctx)
    if (missing === null) return { state: 'blocked' }

    if (ctx.pm === 'pnpm') {
      const added = ensurePnpmAllowedBuilds(ctx)
      if (added.length > 0) {
        ctx.logger.success(`package.json: added ${added.join(', ')} to pnpm.onlyBuiltDependencies`)
      }
    }

    if (missing.length === 0) {
      ctx.logger.info('all required dependencies already declared — nothing to install')
      return { state: 'done' }
    }

    const commands = buildInstallCommands(ctx.pm, missing)
    for (const c of commands) {
      ctx.logger.step(`${c.command} ${c.args.join(' ')}`)
      try {
        await execa(c.command, c.args, { cwd: ctx.cwd, stdio: 'inherit' })
      } catch (e) {
        ctx.logger.error(`install failed: ${(e as Error).message}`)
        return { state: 'blocked' }
      }
    }

    const stillMissing = computeMissing(ctx)
    if (stillMissing && stillMissing.length > 0) {
      ctx.logger.warn(
        `${stillMissing.length} package(s) still missing after install — package.json may not have been updated`
      )
      return { state: 'partial' }
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
    if (present !== null) continue
    missing.push({
      spec,
      presentIn:
        inDeps !== undefined ? 'dependencies' : inDev !== undefined ? 'devDependencies' : null,
      presentVersion: present,
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

function readHostPackageJson(ctx: Context): { path: string; pkg: HostPackageJson } | null {
  const path = ctx.resolve('package.json')
  if (!existsSync(path)) return null
  try {
    return { path, pkg: JSON.parse(readFileSync(path, 'utf8')) as HostPackageJson }
  } catch {
    return null
  }
}

function computeMissingPnpmBuilds(ctx: Context): string[] | null {
  const read = readHostPackageJson(ctx)
  if (!read) return null
  const existing = new Set(read.pkg.pnpm?.onlyBuiltDependencies ?? [])
  return PNPM_ALLOWED_BUILDS.filter((name) => !existing.has(name))
}

/**
 * Adds every entry in `PNPM_ALLOWED_BUILDS` that isn't already present to
 * `package.json` under `pnpm.onlyBuiltDependencies`. Returns the entries
 * that were newly added (empty if everything was already declared).
 *
 * We preserve any existing entries (e.g. `lightningcss` that some
 * TanStack Start scaffolds add) by unioning, not replacing.
 */
function ensurePnpmAllowedBuilds(ctx: Context): string[] {
  const read = readHostPackageJson(ctx)
  if (!read) return []
  const { path, pkg } = read
  const current = pkg.pnpm?.onlyBuiltDependencies ?? []
  const existing = new Set(current)
  const toAdd = PNPM_ALLOWED_BUILDS.filter((name) => !existing.has(name))
  if (toAdd.length === 0) return []

  const next: HostPackageJson = {
    ...pkg,
    pnpm: { ...(pkg.pnpm ?? {}), onlyBuiltDependencies: [...current, ...toAdd] },
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return toAdd
}

function buildInstallCommands(pm: PackageManager, missing: DepStatus[]): ShellCommand[] {
  const runtime = missing
    .filter((m) => m.spec.group !== 'dev')
    .map((m) => `${m.spec.name}@${m.spec.version}`)
  const dev = missing
    .filter((m) => m.spec.group === 'dev')
    .map((m) => `${m.spec.name}@${m.spec.version}`)

  const cmds: ShellCommand[] = []
  if (runtime.length > 0) cmds.push(installCommand(pm, runtime, false))
  if (dev.length > 0) cmds.push(installCommand(pm, dev, true))
  return cmds
}

function installCommand(pm: PackageManager, packages: string[], dev: boolean): ShellCommand {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['add', ...(dev ? ['-D'] : []), ...packages] }
    case 'yarn':
      return { command: 'yarn', args: ['add', ...(dev ? ['-D'] : []), ...packages] }
    case 'bun':
      return { command: 'bun', args: ['add', ...(dev ? ['-d'] : []), ...packages] }
    case 'npm':
      return { command: 'npm', args: ['install', dev ? '--save-dev' : '--save', ...packages] }
  }
}
