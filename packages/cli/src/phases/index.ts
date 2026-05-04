import { dbPhase } from './db.js'
import { dbInitPhase } from './db-init.js'
import { depsPhase } from './deps.js'
import { envPhase } from './env.js'
import { hostPhase } from './host.js'
import { preflightPhase } from './preflight.js'
import { routesPhase } from './routes.js'
import { scaffoldPhase } from './scaffold.js'
import { seedAdminPhase } from './seed-admin.js'
import { stubPhase } from './stub.js'
import { uiPhase } from './ui.js'
import { wirePhase } from './wire/index.js'
import type { Phase, PhaseId } from '../types.js'

export const PHASES: Phase[] = [
  preflightPhase,
  hostPhase,
  dbPhase,
  dbInitPhase,
  envPhase,
  depsPhase,
  scaffoldPhase,
  seedAdminPhase,
  wirePhase,
  routesPhase,
  uiPhase,
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
