import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Context } from '../context.js'
import type { Phase, PhaseState } from '../types.js'

const TANSTACK_DEP = '@tanstack/react-start'
const REQUIRED_FILE = 'src/routes/__root.tsx'
const CREATABLE_FILES: { rel: string; stub: string }[] = [
  {
    rel: 'src/server.ts',
    stub: `import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
`,
  },
  {
    rel: 'src/start.ts',
    stub: `import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({}))
`,
  },
]

export const hostPhase: Phase = {
  id: 'host',
  title: 'Host — detect TanStack Start application',
  defaultMode: 'auto',

  async detect(ctx) {
    return inspectHost(ctx).state
  },

  async plan(ctx) {
    return { writes: [], commands: [], notes: inspectHost(ctx).notes }
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

    for (const f of CREATABLE_FILES) {
      const abs = ctx.resolve(f.rel)
      if (existsSync(abs)) continue
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, f.stub, 'utf8')
      ctx.logger.success(`created ${f.rel} (minimal stub — wire phase will register Byline)`)
    }

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

  // __root.tsx is the only hard requirement — without it the app has no
  // routes whatsoever and isn't really a TanStack Start app yet.
  if (!existsSync(ctx.resolve(REQUIRED_FILE))) {
    return {
      state: 'blocked',
      notes: [...notes, `missing required file: ${REQUIRED_FILE}`],
    }
  }

  // server.ts / start.ts are optional in some bare TanStack Start templates
  // — we'll create minimal stubs in apply() if they're absent so the wire
  // phase has something to inject into.
  const willCreate = CREATABLE_FILES.filter((f) => !existsSync(ctx.resolve(f.rel))).map(
    (f) => f.rel
  )
  if (willCreate.length > 0) {
    notes.push(`will create minimal stubs for: ${willCreate.join(', ')}`)
    return { state: 'pending', notes }
  }
  notes.push('found src/server.ts, src/start.ts, src/routes/__root.tsx')
  return { state: 'done', notes }
}
