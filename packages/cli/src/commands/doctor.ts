import { Context } from '../context.js'
import { PHASES } from '../phases/index.js'
import { createPrompter } from '../prompts.js'
import { StateStore } from '../state.js'
import { renderGrid } from '../ui/grid.js'
import { createLogger } from '../ui/logger.js'
import type { Phase, PhaseState } from '../types.js'

export interface DoctorRow {
  id: string
  title: string
  state: PhaseState
}

export async function runDoctor(): Promise<void> {
  const cwd = process.cwd()
  const logger = createLogger({})
  const prompter = createPrompter({ yes: true })
  const state = new StateStore(cwd)
  const ctx = new Context({
    cwd,
    apply: false,
    dryRun: true,
    yes: true,
    reset: false,
    resetConfirmed: false,
    pm: state.get().answers.pm,
    cliFlags: {},
    logger,
    prompter,
    state,
  })

  const rows = await collectDoctorRows(ctx)

  logger.raw('')
  logger.raw('Byline installation status')
  logger.raw('')
  logger.raw(renderGrid(rows))
  logger.raw('')
  logger.raw(`state file: ${state.filePath()}`)
}

export async function collectDoctorRows(
  ctx: Context,
  phases: readonly Phase[] = PHASES
): Promise<DoctorRow[]> {
  return Promise.all(
    phases.map(async (phase) => ({
      id: phase.id,
      title: phase.title.split(' — ')[0] ?? phase.title,
      state: await phase.detect(ctx),
    }))
  )
}
