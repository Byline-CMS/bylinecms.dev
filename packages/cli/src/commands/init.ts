import { Context } from '../context.js'
import { findPhase, PHASES, phasesBetween, phasesFrom } from '../phases/index.js'
import { createPrompter } from '../prompts.js'
import { runPhase } from '../runner.js'
import { StateStore } from '../state.js'
import { createLogger } from '../ui/logger.js'
import type { PackageManager, PhaseId } from '../types.js'

export interface InitOptions {
  from?: PhaseId
  to?: PhaseId
  only?: PhaseId
  apply?: boolean
  dryRun?: boolean
  yes?: boolean
  reset?: boolean
  resetIMeanIt?: boolean
  force?: boolean
  pm?: PackageManager
  quiet?: boolean
  noColor?: boolean
}

export async function runInit(opts: InitOptions): Promise<void> {
  const cwd = process.cwd()
  const logger = createLogger({ quiet: opts.quiet, noColor: opts.noColor })
  const prompter = createPrompter({ yes: opts.yes })
  const state = new StateStore(cwd)

  const ctx = new Context({
    cwd,
    apply: opts.apply ?? false,
    dryRun: opts.dryRun ?? false,
    yes: opts.yes ?? false,
    reset: opts.reset ?? false,
    resetConfirmed: opts.resetIMeanIt ?? false,
    pm: opts.pm ?? state.get().answers.pm,
    cliFlags: { ...opts } as Record<string, string | boolean | undefined>,
    logger,
    prompter,
    state,
  })

  prompter.intro('Byline CMS installer')
  prompter.note(
    [
      'This installer adds Byline CMS to a TanStack Start app you already own.',
      '',
      'A working reference monorepo (the demo webapp the installer is modelled',
      'on, with example collections, seeds, and route stubs) lives at:',
      '  https://github.com/Byline-CMS/bylinecms.dev',
      '',
      'Useful while installing — keep it open in another tab if you hit a phase',
      'that prints a snippet and bails out to manual.',
    ].join('\n'),
    'Reference: bylinecms.dev'
  )

  const phases = pickPhases(opts, state.get().completedPhases)
  if (phases.length === 0) {
    logger.warn('no phases to run')
    prompter.outro('done')
    return
  }

  for (const phase of phases) {
    let state_: Awaited<ReturnType<typeof runPhase>> | undefined
    try {
      state_ = await runPhase(phase, ctx)
    } catch (e) {
      logger.error(`${phase.id} failed: ${(e as Error).message}`)
      logger.info(`re-run with: byline init --from ${phase.id}`)
      state.flush()
      process.exit(1)
    }
    // Stop the run when a phase is blocked — every downstream phase needs
    // this one's output (db answers, env values, scaffolded files, etc.)
    // and would either fail confusingly or silently misbehave. `partial`
    // is a soft warning (wire's manual sub-edits) — keep going on that.
    if (shouldHaltInit(state_)) {
      logger.info(`re-run with: byline init --from ${phase.id}`)
      state.flush()
      prompter.outro('installation halted — fix the issue above and re-run')
      process.exit(1)
    }
  }

  state.flush()
  prompter.outro('Byline installation complete — see byline doctor for status')
}

export function shouldHaltInit(state: Awaited<ReturnType<typeof runPhase>>): boolean {
  return state === 'blocked'
}

function pickPhases(opts: InitOptions, _completed: PhaseId[]) {
  if (opts.only) {
    const p = findPhase(opts.only)
    return p ? [p] : []
  }
  if (opts.from) return phasesBetween(opts.from, opts.to)
  if (opts.to) return phasesBetween(undefined, opts.to)
  // Always re-detect every phase. Structural detection is cheap and prevents
  // old completion flags from hiding artifacts introduced by a newer CLI.
  return PHASES
}
