import { Context } from '../context.js'
import { PHASES } from '../phases/index.js'
import { createPrompter } from '../prompts.js'
import { StateStore } from '../state.js'
import { renderGrid } from '../ui/grid.js'
import { createLogger } from '../ui/logger.js'

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

  const rows = await Promise.all(
    PHASES.map(async (p) => ({
      id: p.id,
      title: p.title.split(' — ')[0] ?? p.title,
      state: await p.detect(ctx),
    }))
  )

  logger.raw('')
  logger.raw('Byline installation status')
  logger.raw('')
  logger.raw(renderGrid(rows))
  logger.raw('')
  logger.raw(`state file: ${state.filePath()}`)
}
