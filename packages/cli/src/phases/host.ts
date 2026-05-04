import { existsSync, readFileSync } from 'node:fs'

import type { Context } from '../context.js'
import type { Phase, PhaseState } from '../types.js'

const TANSTACK_DEP = '@tanstack/react-start'
const REQUIRED_FILES = ['src/server.ts', 'src/start.ts', 'src/routes/__root.tsx']

export const hostPhase: Phase = {
  id: 'host',
  title: 'Host — detect TanStack Start application',
  defaultMode: 'auto',

  async detect(ctx) {
    return inspectHost(ctx).state
  },

  async plan(ctx) {
    const r = inspectHost(ctx)
    return { writes: [], commands: [], notes: r.notes }
  },

  async apply(_plan, ctx) {
    const r = inspectHost(ctx)
    if (r.state === 'blocked') {
      ctx.logger.error('host detection failed:')
      for (const n of r.notes) ctx.logger.error(`  ${n}`)
      ctx.logger.info(
        'see https://tanstack.com/start/latest/docs/framework/react/quick-start to bootstrap a new app'
      )
      return { state: 'blocked' }
    }
    for (const n of r.notes) ctx.logger.info(n)
    return { state: 'done' }
  },
}

interface HostInspection {
  state: PhaseState
  notes: string[]
}

function inspectHost(ctx: Context): HostInspection {
  const notes: string[] = []
  const pkgPath = ctx.resolve('package.json')
  if (!existsSync(pkgPath)) {
    return { state: 'blocked', notes: ['no package.json in current directory'] }
  }

  let pkg: { name?: string; dependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch (e) {
    return { state: 'blocked', notes: [`package.json parse error: ${(e as Error).message}`] }
  }

  const deps = { ...(pkg.dependencies ?? {}) }
  if (!deps[TANSTACK_DEP]) {
    return {
      state: 'blocked',
      notes: [
        `${TANSTACK_DEP} not found in dependencies — this doesn't look like a TanStack Start app`,
      ],
    }
  }
  notes.push(`${TANSTACK_DEP} ${deps[TANSTACK_DEP]} — detected`)

  const missing = REQUIRED_FILES.filter((f) => !existsSync(ctx.resolve(f)))
  if (missing.length > 0) {
    return {
      state: 'blocked',
      notes: [...notes, `missing required files: ${missing.join(', ')}`],
    }
  }
  notes.push('found src/server.ts, src/start.ts, src/routes/__root.tsx')

  return { state: 'done', notes }
}
