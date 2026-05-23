import { existsSync } from 'node:fs'

import { execa } from 'execa'

import type { Context } from '../context.js'
import type { Phase, ShellCommand } from '../types.js'

const SEED_ENTRY = 'byline/seed-admin.ts'

export const seedAdminPhase: Phase = {
  id: 'seed-admin',
  title: 'Seed admin — bootstrap the super-admin user from .env credentials',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.state.isComplete('seed-admin')) return 'done'
    return preflightCheck(ctx) ?? 'pending'
  },

  async plan(ctx) {
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
  if (!existsSync(ctx.resolve('byline/seeds/admin.ts'))) {
    ctx.logger.error('byline/seeds/admin.ts not found — run scaffold first')
    return 'blocked'
  }
  if (!existsSync(ctx.resolve('.env')) && !existsSync(ctx.resolve('.env.local'))) {
    ctx.logger.error('neither .env nor .env.local found — run env phase first')
    return 'blocked'
  }
  return null
}

function seedCommand(ctx: Context): ShellCommand {
  // Pass both env files to the runner so the seed picks up secrets from
  // `.env.local` (JWT signing key, superadmin creds, DB URL) as well as
  // public defaults from `.env`. Later `--env-file` flags override earlier
  // ones in Node, matching Vite's precedence (`.env.local` wins). This is
  // belt-and-braces alongside the template-side `byline/load-env.ts` import:
  // host apps scaffolded with an older CLI that still do
  // `import 'dotenv/config'` (which only loads `.env`) work because Node
  // has already populated `process.env` before the script runs.
  //
  // Only include flags for files that actually exist — Node's `--env-file`
  // (unlike `--env-file-if-exists`, which is 22.6+) errors on a missing
  // path, and we want to tolerate the case where the user has only one of
  // the two files. `preflightCheck` above guarantees at least one exists.
  const envFlags: string[] = []
  if (existsSync(ctx.resolve('.env'))) envFlags.push('--env-file=.env')
  if (existsSync(ctx.resolve('.env.local'))) envFlags.push('--env-file=.env.local')
  switch (ctx.pm) {
    case 'bun':
      // Bun runs TypeScript natively and recognises Node's `--env-file`
      // flag, so the same pattern applies.
      return { command: 'bun', args: [...envFlags, SEED_ENTRY] }
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', 'tsx', ...envFlags, SEED_ENTRY] }
    case 'yarn':
      return { command: 'yarn', args: ['tsx', ...envFlags, SEED_ENTRY] }
    case 'npm':
      return { command: 'npx', args: ['--yes', 'tsx', ...envFlags, SEED_ENTRY] }
  }
}
