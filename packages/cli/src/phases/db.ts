import { Client } from 'pg'

import { buildPgUrl, parsePgUrl } from '../lib/pg-url.js'
import type { Phase } from '../types.js'

export const dbPhase: Phase = {
  id: 'db',
  title: 'Database — choose strategy and verify connection',
  defaultMode: 'confirm',

  async detect(ctx) {
    return ctx.state.isComplete('db') ? 'done' : 'pending'
  },

  async plan(ctx) {
    const a = ctx.state.get().answers
    const notes: string[] = []
    if (a.dbStrategy) notes.push(`strategy: ${a.dbStrategy}`)
    if (a.dbHost) notes.push(`host: ${a.dbHost}:${a.dbPort}`)
    if (a.dbName) notes.push(`database: ${a.dbName}`)
    if (a.dbUser) notes.push(`role: ${a.dbUser}`)
    if (notes.length === 0) notes.push('will prompt for database connection details')
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const strategy = await ctx.prompter.select({
      message: 'How will Byline connect to Postgres?',
      options: [
        { value: 'existing', label: 'I have a running Postgres I will provide credentials for' },
        { value: 'docker', label: 'Use the bundled docker-compose to spin one up' },
      ],
    })

    if (strategy === 'docker') {
      ctx.logger.warn('docker strategy is stubbed for v1 — please use --strategy existing for now')
      return { state: 'blocked' }
    }

    const superuserUrl = await ctx.prompter.text({
      message: 'Postgres superuser connection URL (used for role/database creation)',
      placeholder: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
      defaultValue: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
    })

    const dbName = await ctx.prompter.text({
      message: 'Database name to create',
      defaultValue: 'byline',
    })
    if (!isValidIdentifier(dbName)) {
      ctx.logger.error(`invalid db name "${dbName}" — must match /^[a-z_][a-z0-9_]{0,62}$/`)
      return { state: 'blocked' }
    }

    const dbUser = await ctx.prompter.text({
      message: 'Application role (database user)',
      defaultValue: 'byline',
    })
    if (!isValidIdentifier(dbUser)) {
      ctx.logger.error(`invalid role "${dbUser}" — must match /^[a-z_][a-z0-9_]{0,62}$/`)
      return { state: 'blocked' }
    }

    const sup = parsePgUrl(superuserUrl)

    const spinner = ctx.prompter.spinner()
    spinner.start(`testing superuser connection to ${sup.host}:${sup.port}`)
    const client = new Client({ connectionString: superuserUrl })
    try {
      await client.connect()
      const r = await client.query<{ version: string }>('SELECT version()')
      spinner.stop(`connected — ${r.rows[0]?.version.split(' ').slice(0, 2).join(' ')}`)
    } catch (e) {
      spinner.stop('connection failed')
      ctx.logger.error((e as Error).message)
      return { state: 'blocked' }
    } finally {
      await client.end().catch(() => {})
    }

    // Superuser URL carries the superuser password — keep it in-memory only
    // (mirrors how `ctx.secrets.dbPassword` is handled) so it never lands in
    // `.byline-install.json`. If a later phase needs it after a process
    // restart, it will re-prompt.
    ctx.secrets.superuserUrl = superuserUrl
    ctx.state.patchAnswers({
      dbStrategy: strategy,
      dbHost: sup.host,
      dbPort: sup.port,
      dbName,
      dbUser,
    })
    ctx.logger.info(`will provision database "${dbName}" owned by role "${dbUser}"`)
    return { state: 'done' }
  },
}

export function isValidIdentifier(s: string): boolean {
  return /^[a-z_][a-z0-9_]{0,62}$/.test(s)
}

export function buildAppConnUrl(opts: {
  host: string
  port: number
  user: string
  password: string
  database: string
}): string {
  return buildPgUrl(opts)
}
