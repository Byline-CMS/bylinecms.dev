import { Context } from '../context.js'
import { dbPhase } from '../phases/db.js'
import { dbInitPhase } from '../phases/db-init.js'
import { preflightPhase } from '../phases/preflight.js'
import { seedAdminPhase } from '../phases/seed-admin.js'
import { seedDocsPhase } from '../phases/seed-docs.js'
import { createPrompter } from '../prompts.js'
import { runPhase } from '../runner.js'
import { StateStore } from '../state.js'
import { createLogger } from '../ui/logger.js'
import { runSetupChecks } from './setup-checks.js'
import type { DatabaseAdapterId, PackageManager, Phase, PhaseId } from '../types.js'

export interface SetupOptions {
  noSeedAdmin?: boolean
  noSeedDocs?: boolean
  apply?: boolean
  dryRun?: boolean
  yes?: boolean
  reset?: boolean
  resetIMeanIt?: boolean
  force?: boolean
  database?: DatabaseAdapterId
  pm?: PackageManager
  quiet?: boolean
  noColor?: boolean
}

export interface SetupFlowDependencies {
  runPhase: typeof runPhase
  runChecks: typeof runSetupChecks
  preflightPhase: Phase
  dbPhase: Phase
  dbInitPhase: Phase
  seedAdminPhase: Phase
  seedDocsPhase: Phase
}

export type SetupFlowResult =
  | { state: 'done' }
  | {
      state: 'halted'
      stage: PhaseId | 'checks'
      error?: Error
    }

const DEFAULT_SETUP_FLOW_DEPENDENCIES: SetupFlowDependencies = {
  runPhase,
  runChecks: runSetupChecks,
  preflightPhase,
  dbPhase,
  dbInitPhase,
  seedAdminPhase,
  seedDocsPhase,
}

/**
 * Post-manual-config flow: prepare the database and (optionally) seed
 * the super-admin and example docs. Skips every phase that mutates
 * project files (env, deps, wire, routes, scaffold, ui) — those are
 * assumed to be in place already.
 *
 * Runs db → db-init → seed-admin → seed-docs, honouring `--no-seed-*`
 * toggles. Reuses the same Phase + runner machinery as `byline init`.
 */
export async function runSetup(opts: SetupOptions): Promise<void> {
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

  prompter.intro('Byline CMS setup')
  prompter.note(
    [
      'Prepares the database and seeds the super-admin / example docs.',
      'Use this when you have already wired Byline into your TanStack',
      'Start app by hand (collections, server.config.ts, env, routes,',
      'scaffold all in place) and just need to provision and seed.',
      '',
      'For new TanStack Start apps, run `byline init` instead.',
    ].join('\n'),
    'Setup (post-manual-config)'
  )

  // --force re-runs every phase regardless of recorded state. Combine
  // with --reset --i-mean-it to also drop & recreate the database; the
  // db-init phase confirms the drop interactively unless --i-mean-it
  // is passed.
  if (opts.force) {
    const notes = ['re-running every setup phase regardless of recorded state']
    if (opts.reset) {
      notes.push('--reset is set: the database WILL be dropped and recreated')
      notes.push('existing document data WILL be lost')
    } else {
      notes.push('database is NOT being reset (pass --reset to drop and recreate)')
      notes.push('the database phase will still refuse every occupied database')
      notes.push('a fresh baseline is never treated as an upgrade, even under --force')
    }
    prompter.note(notes.join('\n'), '--force')

    if (!opts.yes) {
      const ok = await prompter.confirm({
        message: opts.reset
          ? 'Continue? This will DROP your database.'
          : 'Continue with forced re-run?',
        defaultValue: false,
      })
      if (!ok) {
        prompter.outro('setup cancelled')
        return
      }
    }
  }

  const result = await runSetupFlow(ctx, opts)
  if (result.state === 'halted') {
    if (result.error) logger.error(`${result.stage} failed: ${result.error.message}`)
    state.flush()
    if (result.stage === 'preflight') {
      prompter.outro('setup halted — preflight checks failed')
    } else if (result.stage === 'checks') {
      prompter.outro('setup halted — pre-flight checks failed')
    } else {
      logger.info(`re-run with: byline setup (resumes from ${result.stage})`)
      prompter.outro('setup halted — fix the issue above and re-run')
    }
    process.exit(1)
  }

  state.flush()
  prompter.outro('Byline setup complete — see byline doctor for status')
}

/**
 * Execute the setup phases around the adapter-aware manual-install checks.
 * Keeping this orchestration separate from process construction makes the
 * safety ordering directly testable:
 *
 * preflight → database selection/connection → dependency + env checks
 * → database initialization → optional seeds.
 */
export async function runSetupFlow(
  ctx: Context,
  opts: Pick<SetupOptions, 'noSeedAdmin' | 'noSeedDocs'>,
  dependencies: SetupFlowDependencies = DEFAULT_SETUP_FLOW_DEPENDENCIES
): Promise<SetupFlowResult> {
  for (const phase of [dependencies.preflightPhase, dependencies.dbPhase]) {
    let phaseState: Awaited<ReturnType<typeof runPhase>>
    try {
      phaseState = await dependencies.runPhase(phase, ctx)
    } catch (error) {
      return { state: 'halted', stage: phase.id, error: error as Error }
    }
    if (phaseState === 'blocked' || phaseState === 'pending') {
      return { state: 'halted', stage: phase.id }
    }
  }

  let checks: Awaited<ReturnType<typeof runSetupChecks>>
  try {
    checks = await dependencies.runChecks(ctx)
  } catch (error) {
    return { state: 'halted', stage: 'checks', error: error as Error }
  }
  if (checks === 'aborted') {
    return { state: 'halted', stage: 'checks' }
  }

  const phases: Phase[] = [dependencies.dbInitPhase]
  if (!opts.noSeedAdmin) phases.push(dependencies.seedAdminPhase)
  if (!opts.noSeedDocs) phases.push(dependencies.seedDocsPhase)

  for (const phase of phases) {
    let phaseState: Awaited<ReturnType<typeof runPhase>>
    try {
      phaseState = await dependencies.runPhase(phase, ctx)
    } catch (error) {
      return {
        state: 'halted',
        stage: phase.id,
        error: error as Error,
      }
    }
    if (
      phaseState === 'blocked' ||
      (phase.id === dependencies.dbInitPhase.id && phaseState === 'pending')
    ) {
      return { state: 'halted', stage: phase.id }
    }
  }

  return { state: 'done' }
}
