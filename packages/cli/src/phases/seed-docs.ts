import { existsSync } from 'node:fs'

import { execa } from 'execa'

import type { Context } from '../context.js'
import type { Phase, ShellCommand } from '../types.js'

const SEED_ENTRY = 'byline/seed-docs.ts'

export const seedDocsPhase: Phase = {
  id: 'seed-docs',
  title: 'Seed example docs — bootstrap example docs',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.state.isComplete('seed-docs')) return 'done'
    return preflightCheck(ctx) ?? 'pending'
  },

  async plan(ctx) {
    if (ctx.state.get().answers.examples === false) {
      ctx.logger.info('seed-docs — skipped (examples not installed)')
      return { writes: [], commands: [], notes: [] }
    }
    const blocked = preflightCheck(ctx)
    if (blocked) {
      return {
        writes: [],
        commands: [],
        notes: ['cannot run seed yet — earlier phase prerequisites missing'],
      }
    }
    const cmd = seedCommand(ctx)
    return {
      writes: [],
      commands: [cmd],
      notes: [
        `runs ${SEED_ENTRY} via the ${ctx.pm} runner`,
        'reads BYLINE_SUPERADMIN_EMAIL / BYLINE_SUPERADMIN_PASSWORD from .env.local',
        'idempotent — re-running is safe; already-seeded admin reports "no changes"',
      ],
    }
  },

  async apply(_plan, ctx) {
    const blocked = preflightCheck(ctx)
    if (blocked) return { state: blocked }

    const cmd = seedCommand(ctx)
    ctx.logger.step(`${cmd.command} ${cmd.args.join(' ')}`)
    try {
      await execa(cmd.command, cmd.args, { cwd: ctx.cwd, stdio: 'inherit' })
    } catch (e) {
      ctx.logger.error(`seed failed: ${(e as Error).message}`)
      return { state: 'blocked' }
    }
    return { state: 'done' }
  },
}

/**
 * Cheap up-front checks for the obvious "you skipped a phase" failure
 * modes. Returns `'blocked'` if a hard prerequisite is missing, `null`
 * when ready to proceed.
 */
function preflightCheck(ctx: Context): 'blocked' | null {
  if (!existsSync(ctx.resolve(SEED_ENTRY))) {
    ctx.logger.error(`${SEED_ENTRY} not found — run scaffold first`)
    return 'blocked'
  }
  if (!existsSync(ctx.resolve('byline/seeds/docs.ts'))) {
    ctx.logger.error('byline/seeds/docs.ts not found — run scaffold first')
    return 'blocked'
  }
  if (!existsSync(ctx.resolve('.env')) && !existsSync(ctx.resolve('.env.local'))) {
    ctx.logger.error('neither .env nor .env.local found — run env phase first')
    return 'blocked'
  }
  return null
}

function seedCommand(ctx: Context): ShellCommand {
  // See `phases/seed-admin.ts` for why both env files are passed through
  // — same belt-and-braces pattern (works for fresh templates AND older
  // scaffolded projects that still do `import 'dotenv/config'`). Skip the
  // flag for any file that doesn't exist; Node's `--env-file` errors on a
  // missing path.
  const envFlags: string[] = []
  if (existsSync(ctx.resolve('.env'))) envFlags.push('--env-file=.env')
  if (existsSync(ctx.resolve('.env.local'))) envFlags.push('--env-file=.env.local')
  switch (ctx.pm) {
    case 'bun':
      return { command: 'bun', args: [...envFlags, SEED_ENTRY] }
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', 'tsx', ...envFlags, SEED_ENTRY] }
    case 'yarn':
      return { command: 'yarn', args: ['tsx', ...envFlags, SEED_ENTRY] }
    case 'npm':
      return { command: 'npx', args: ['--yes', 'tsx', ...envFlags, SEED_ENTRY] }
  }
}
