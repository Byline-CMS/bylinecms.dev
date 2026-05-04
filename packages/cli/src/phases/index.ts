import { dbPhase } from './db.js'
import { dbInitPhase } from './db-init.js'
import { hostPhase } from './host.js'
import { preflightPhase } from './preflight.js'
import { stubPhase } from './stub.js'
import type { Phase, PhaseId } from '../types.js'

export const PHASES: Phase[] = [
  preflightPhase,
  hostPhase,
  dbPhase,
  dbInitPhase,
  stubPhase('env', 'Env — generate .env (JWT secret, admin credentials, DATABASE_URL)'),
  stubPhase('deps', 'Deps — install required @byline/* packages'),
  stubPhase('scaffold', 'Scaffold — copy byline/ config tree into app root'),
  stubPhase(
    'wire',
    'Wire — inject imports into server.ts, start.ts, __root.tsx, tsconfig, vite.config'
  ),
  stubPhase('routes', 'Routes — drop src/routes/(byline)/admin route stubs'),
  stubPhase('ui', 'UI — copy serialization components to src/ui/byline'),
  stubPhase('verify', 'Verify — typecheck and smoke-test admin route'),
]

export const PHASE_IDS = PHASES.map((p) => p.id) as PhaseId[]

export function findPhase(id: PhaseId): Phase | undefined {
  return PHASES.find((p) => p.id === id)
}

export function phasesFrom(id: PhaseId): Phase[] {
  const idx = PHASES.findIndex((p) => p.id === id)
  return idx === -1 ? [] : PHASES.slice(idx)
}

export function phasesBetween(from: PhaseId | undefined, to: PhaseId | undefined): Phase[] {
  const fromIdx = from ? PHASES.findIndex((p) => p.id === from) : 0
  const toIdx = to ? PHASES.findIndex((p) => p.id === to) : PHASES.length - 1
  if (fromIdx === -1 || toIdx === -1 || fromIdx > toIdx) return []
  return PHASES.slice(fromIdx, toIdx + 1)
}
