import { existsSync, readFileSync } from 'node:fs'

import { execa } from 'execa'

import { DEP_SPECS, type DepSpec } from '../manifest/deps.js'
import type { Context } from '../context.js'
import type { PackageManager, Phase, ShellCommand } from '../types.js'

interface DepStatus {
  spec: DepSpec
  presentIn: 'dependencies' | 'devDependencies' | null
  presentVersion: string | null
}

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
    if (missing.length === 0) {
      return { writes: [], commands: [], notes: ['all required dependencies already declared'] }
    }

    const notes: string[] = [
      `${missing.length} package(s) to install via ${ctx.pm}`,
      ...missing.map(
        ({ spec }) => `  + ${spec.name}@${spec.version}  (${spec.group}) — ${spec.note}`
      ),
    ]
    return { writes: [], commands: buildInstallCommands(ctx.pm, missing), notes }
  },

  async apply(_plan, ctx) {
    const missing = computeMissing(ctx)
    if (missing === null) return { state: 'blocked' }
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

  const missing: DepStatus[] = []
  for (const spec of DEP_SPECS) {
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
