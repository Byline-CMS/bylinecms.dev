import { existsSync, readFileSync } from 'node:fs'

import type { Context } from '../context.js'
import type { PackageManager, Phase } from '../types.js'

export const preflightPhase: Phase = {
  id: 'preflight',
  title: 'Preflight — environment checks',
  defaultMode: 'auto',

  async detect(ctx) {
    return ctx.state.isComplete('preflight') ? 'done' : 'pending'
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
    ctx.pm = pm
    ctx.state.patchAnswers({ pm })
    ctx.logger.info(`package manager: ${pm}`)

    return { state: 'done' }
  },
}

async function resolvePackageManager(ctx: Context): Promise<PackageManager> {
  const fromFlag = ctx.cliFlags.pm as PackageManager | undefined
  if (fromFlag) {
    ctx.logger.info(`using --pm ${fromFlag}`)
    return fromFlag
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
  if (existsSync(`${cwd}/pnpm-lock.yaml`)) return 'pnpm'
  if (existsSync(`${cwd}/bun.lockb`) || existsSync(`${cwd}/bun.lock`)) return 'bun'
  if (existsSync(`${cwd}/yarn.lock`)) return 'yarn'
  if (existsSync(`${cwd}/package-lock.json`)) return 'npm'
  const pkgPath = `${cwd}/package.json`
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { packageManager?: string }
      if (pkg.packageManager?.startsWith('pnpm')) return 'pnpm'
      if (pkg.packageManager?.startsWith('yarn')) return 'yarn'
      if (pkg.packageManager?.startsWith('bun')) return 'bun'
      if (pkg.packageManager?.startsWith('npm')) return 'npm'
    } catch {}
  }
  return 'pnpm'
}
