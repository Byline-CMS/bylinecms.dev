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
import type { PackageManager, Phase } from '../types.js'

export interface SetupOptions {
  noSeedAdmin?: boolean
  noSeedDocs?: boolean
  apply?: boolean
  dryRun?: boolean
  yes?: boolean
  reset?: boolean
  resetIMeanIt?: boolean
  pm?: PackageManager
  quiet?: boolean
  noColor?: boolean
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
    pm: opts.pm,
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

  // Run the existing preflight phase first so Node version + git + the
  // package manager are resolved before any setup-specific checks read
  // ctx.pm. Preflight is `defaultMode: 'auto'`, so it just runs.
  let preflightState: Awaited<ReturnType<typeof runPhase>>
  try {
    preflightState = await runPhase(preflightPhase, ctx)
  } catch (e) {
    logger.error(`preflight failed: ${(e as Error).message}`)
    state.flush()
    process.exit(1)
  }
  if (preflightState === 'blocked' || preflightState === 'pending') {
    state.flush()
    prompter.outro('setup halted — preflight checks failed')
    process.exit(1)
  }

  const checks = await runSetupChecks(ctx)
  if (checks === 'aborted') {
    state.flush()
    prompter.outro('setup halted — pre-flight checks failed')
    process.exit(1)
  }

  const phases: Phase[] = [dbPhase, dbInitPhase]
  if (!opts.noSeedAdmin) phases.push(seedAdminPhase)
  if (!opts.noSeedDocs) phases.push(seedDocsPhase)

  for (const phase of phases) {
    let state_: Awaited<ReturnType<typeof runPhase>> | undefined
    try {
      state_ = await runPhase(phase, ctx)
    } catch (e) {
      logger.error(`${phase.id} failed: ${(e as Error).message}`)
      logger.info(`re-run with: byline setup (resumes from this phase)`)
      state.flush()
      process.exit(1)
    }
    if (state_ === 'blocked') {
      logger.info(`re-run with: byline setup (resumes from this phase)`)
      state.flush()
      prompter.outro('setup halted — fix the issue above and re-run')
      process.exit(1)
    }
  }

  state.flush()
  prompter.outro('Byline setup complete — see byline doctor for status')
}
