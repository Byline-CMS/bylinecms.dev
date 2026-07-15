import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ancestors,
  resolveWorkspaceOwnership,
  validateWorkspacePackageManager,
  workspaceManagerConstraint,
} from '../lib/workspace-root.js'
import type { Context } from '../context.js'
import type { PackageManager, Phase } from '../types.js'

export const preflightPhase: Phase = {
  id: 'preflight',
  title: 'Preflight — environment checks',
  defaultMode: 'auto',

  async detect(ctx) {
    if (!ctx.state.isComplete('preflight')) return 'pending'
    const selected = (ctx.cliFlags.pm as PackageManager | undefined) ?? ctx.state.get().answers.pm
    const constraint = workspaceManagerConstraint(ctx.cwd)
    const resolved = selected ?? constraint.manager
    if (!resolved || !validateWorkspacePackageManager(ctx.cwd, resolved).valid) return 'pending'
    ctx.pm = resolved
    return 'done'
  },

  async plan(_ctx) {
    return { writes: [], commands: [], notes: ['check Node version, git repo, package manager'] }
  },

  async apply(_plan, ctx) {
    const major = Number(process.versions.node.split('.')[0])
    if (major < 20) {
      ctx.logger.error(`Node 20.9+ required (found ${process.versions.node})`)
      return { state: 'blocked' }
    }

    if (!existsSync(ctx.resolve('.git'))) {
      ctx.logger.warn('not a git repository — strongly recommended for installer rollback')
      const ok = await ctx.prompter.confirm({
        message: 'Continue without git?',
        defaultValue: false,
      })
      if (!ok) return { state: 'blocked' }
    }

    const pm = await resolvePackageManager(ctx)
    if (!pm) return { state: 'blocked' }
    ctx.pm = pm
    ctx.state.patchAnswers({ pm })
    ctx.logger.info(`package manager: ${pm}`)

    return { state: 'done' }
  },
}

async function resolvePackageManager(ctx: Context): Promise<PackageManager | null> {
  const fromFlag = ctx.cliFlags.pm as PackageManager | undefined
  const persisted = ctx.state.get().answers.pm
  const constraint = workspaceManagerConstraint(ctx.cwd)
  if (constraint.ambiguous) {
    ctx.logger.error(`${constraint.reason}; remove conflicting root metadata or lockfiles`)
    return null
  }
  if (constraint.manager) {
    const selected = fromFlag ?? persisted
    if (selected && selected !== constraint.manager) {
      ctx.logger.error(
        `owning workspace uses ${constraint.manager}; use --pm ${constraint.manager}`
      )
      return null
    }
    ctx.logger.info(`using owning workspace package manager: ${constraint.manager}`)
    return constraint.manager
  }
  if (fromFlag) {
    ctx.logger.info(`using --pm ${fromFlag}`)
    return fromFlag
  }
  if (persisted) {
    ctx.logger.info(`using previously selected package manager: ${persisted}`)
    return persisted
  }
  const ownership = resolveWorkspaceOwnership(ctx.cwd)
  if (ownership.kind === 'package-json' && ctx.yes) {
    ctx.logger.error(
      'workspace has no authoritative package manager; pass --pm pnpm, npm, yarn, or bun'
    )
    return null
  }
  const detected = detectPackageManager(ctx.cwd)
  if (ctx.yes) return detected

  // Put the detected manager first so --yes / pressing Enter accepts it,
  // but let the user pick another if their fresh app has no lockfile yet
  // and the detection defaulted to pnpm.
  const others = (['pnpm', 'npm', 'yarn', 'bun'] as PackageManager[]).filter((p) => p !== detected)
  return ctx.prompter.select<PackageManager>({
    message: 'Package manager to use for installs',
    options: [
      { value: detected, label: detected, hint: 'detected' },
      ...others.map((p) => ({ value: p, label: p })),
    ],
  })
}

export function detectPackageManager(cwd: string): PackageManager {
  const constraint = workspaceManagerConstraint(cwd)
  if (constraint.ambiguous) throw new Error(constraint.reason)
  if (constraint.manager) return constraint.manager
  const ownership = resolveWorkspaceOwnership(cwd)
  const relevantDirectories =
    ownership.kind === 'standalone'
      ? [ownership.root]
      : ancestors(cwd).slice(0, ancestors(cwd).indexOf(ownership.root) + 1)
  for (const directory of relevantDirectories) {
    const pkgPath = join(directory, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { packageManager?: string }
      if (pkg.packageManager?.startsWith('pnpm')) return 'pnpm'
      if (pkg.packageManager?.startsWith('yarn')) return 'yarn'
      if (pkg.packageManager?.startsWith('bun')) return 'bun'
      if (pkg.packageManager?.startsWith('npm')) return 'npm'
    } catch {}
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return 'pnpm'
    if (existsSync(join(directory, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(directory, 'bun.lockb')) || existsSync(join(directory, 'bun.lock'))) {
      return 'bun'
    }
    if (existsSync(join(directory, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(directory, 'package-lock.json'))) return 'npm'
  }
  return 'pnpm'
}
