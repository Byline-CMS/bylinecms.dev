#!/usr/bin/env node
import { Command } from 'commander'

import { runDoctor } from './commands/doctor.js'
import { runInit } from './commands/init.js'
import { runSetup } from './commands/setup.js'
import { CLI_PACKAGE_VERSION } from './lib/release-policy.js'
import { PHASE_IDS } from './phases/index.js'
import type { PackageManager, PhaseId } from './types.js'

const PACKAGE_MANAGERS: PackageManager[] = ['pnpm', 'npm', 'yarn', 'bun']

const program = new Command()

program
  .name('byline')
  .description('Guided installer for Byline CMS into a TanStack Start application')
  .version(CLI_PACKAGE_VERSION)

program
  .command('init')
  .description('Run the guided installer (re-detects current installation state)')
  .option('--from <phase>', `start from phase (${PHASE_IDS.join('|')})`)
  .option('--to <phase>', 'stop after phase')
  .option('--only <phase>', 'run a single phase')
  .option('--apply', 'skip per-phase confirmation prompts (still prints diffs)')
  .option('--dry-run', 'show every change but write nothing')
  .option('-y, --yes', 'assume yes to non-write prompts')
  .option('--reset', 'destructive: drop existing database in db-init')
  .option('--i-mean-it', 'second confirmation required by --reset')
  .option('--force', 're-run phases even when detection reports them complete')
  .option('--pm <pm>', `force package manager: ${PACKAGE_MANAGERS.join('|')}`)
  .option('-q, --quiet', 'suppress decorative output')
  .option('--no-color', 'disable color output')
  .action(async (raw) => {
    const opts = raw as Record<string, unknown>
    if (opts.from) assertPhaseId(opts.from as string, '--from')
    if (opts.to) assertPhaseId(opts.to as string, '--to')
    if (opts.only) assertPhaseId(opts.only as string, '--only')
    if (opts.pm) assertPackageManager(opts.pm as string)
    await runInit({
      from: opts.from as PhaseId | undefined,
      to: opts.to as PhaseId | undefined,
      only: opts.only as PhaseId | undefined,
      apply: opts.apply as boolean | undefined,
      dryRun: opts.dryRun as boolean | undefined,
      yes: opts.yes as boolean | undefined,
      reset: opts.reset as boolean | undefined,
      resetIMeanIt: opts.iMeanIt as boolean | undefined,
      force: opts.force as boolean | undefined,
      pm: opts.pm as PackageManager | undefined,
      quiet: opts.quiet as boolean | undefined,
      noColor: opts.color === false,
    })
  })

program
  .command('setup')
  .description(
    'Prepare DB and seed admin/docs for an app that is already wired (post-manual-config)'
  )
  .option('--no-seed-admin', 'skip the super-admin seed')
  .option('--no-seed-docs', 'skip the example docs seed')
  .option('--apply', 'skip per-phase confirmation prompts (still prints diffs)')
  .option('--dry-run', 'show every change but write nothing')
  .option('-y, --yes', 'assume yes to non-write prompts')
  .option('--reset', 'destructive: drop existing database in db-init')
  .option('--i-mean-it', 'second confirmation required by --reset')
  .option('--force', 're-run every phase even if recorded as complete')
  .option('--pm <pm>', `force package manager: ${PACKAGE_MANAGERS.join('|')}`)
  .option('-q, --quiet', 'suppress decorative output')
  .option('--no-color', 'disable color output')
  .action(async (raw) => {
    const opts = raw as Record<string, unknown>
    if (opts.pm) assertPackageManager(opts.pm as string)
    await runSetup({
      // commander flips `--no-seed-admin` to `seedAdmin: false`
      noSeedAdmin: opts.seedAdmin === false,
      noSeedDocs: opts.seedDocs === false,
      apply: opts.apply as boolean | undefined,
      dryRun: opts.dryRun as boolean | undefined,
      yes: opts.yes as boolean | undefined,
      reset: opts.reset as boolean | undefined,
      resetIMeanIt: opts.iMeanIt as boolean | undefined,
      force: opts.force as boolean | undefined,
      pm: opts.pm as PackageManager | undefined,
      quiet: opts.quiet as boolean | undefined,
      noColor: opts.color === false,
    })
  })

program
  .command('doctor')
  .description('Inspect the current app and report which install phases are wired')
  .action(async () => {
    await runDoctor()
  })

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(e.message)
  process.exit(1)
})

function assertPhaseId(value: string, flag: string): asserts value is PhaseId {
  if (!(PHASE_IDS as readonly string[]).includes(value)) {
    console.error(`${flag}: invalid phase "${value}". Valid: ${PHASE_IDS.join(', ')}`)
    process.exit(1)
  }
}

function assertPackageManager(value: string): asserts value is PackageManager {
  if (!(PACKAGE_MANAGERS as readonly string[]).includes(value)) {
    console.error(`--pm: invalid value "${value}". Valid: ${PACKAGE_MANAGERS.join(', ')}`)
    process.exit(1)
  }
}
