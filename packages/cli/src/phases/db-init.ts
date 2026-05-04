import { resolve } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

import { buildPgUrl, parsePgUrl, withDatabase } from '../lib/pg-url.js'
import { isValidIdentifier } from './db.js'
import type { Context } from '../context.js'
import type { Phase } from '../types.js'

const REQUIRED_EXTENSIONS = ['pgcrypto']

export const dbInitPhase: Phase = {
  id: 'db-init',
  title: 'Database initialization — provision role + database, install extensions, run migrations',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.state.isComplete('db-init')) return 'done'
    const a = ctx.state.get().answers
    if (!a.superuserUrl || !a.dbName || !a.dbUser) return 'blocked'
    return 'pending'
  },

  async plan(ctx) {
    const a = ctx.state.get().answers
    const notes: string[] = []
    if (a.dbName) notes.push(`provision database "${a.dbName}"`)
    if (a.dbUser) notes.push(`provision role "${a.dbUser}" (CREATE IF NOT EXISTS)`)
    if (ctx.reset) {
      notes.push('--reset: existing database will be DROPPED if present')
    } else {
      notes.push('non-destructive: existing database/role will be reused')
    }
    notes.push(`install extensions: ${REQUIRED_EXTENSIONS.join(', ')}`)
    notes.push('run drizzle migrations from bundled @byline/cli templates')
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const a = ctx.state.get().answers
    if (!a.superuserUrl || !a.dbName || !a.dbUser) {
      ctx.logger.error('db-init prerequisites missing — run the db phase first')
      return { state: 'blocked' }
    }
    if (!isValidIdentifier(a.dbName) || !isValidIdentifier(a.dbUser)) {
      ctx.logger.error('invalid identifier — internal state is corrupt; clear .byline-install.json')
      return { state: 'blocked' }
    }

    const password = await resolveAppPassword(ctx)
    if (!password) return { state: 'blocked' }
    ctx.secrets.dbPassword = password

    const sup = parsePgUrl(a.superuserUrl)

    if (ctx.reset && !ctx.resetConfirmed) {
      const ok = await ctx.prompter.confirm({
        message: `RESET will DROP database "${a.dbName}" if it exists. Continue?`,
        defaultValue: false,
      })
      if (!ok) {
        ctx.logger.info('reset cancelled')
        return { state: 'blocked' }
      }
    }

    await provisionRoleAndDatabase(ctx, {
      sup,
      dbName: a.dbName,
      dbUser: a.dbUser,
      password,
      reset: ctx.reset,
    })

    await installExtensions(ctx, withDatabase(sup, a.dbName))

    await runMigrations(ctx, {
      host: sup.host,
      port: sup.port,
      user: a.dbUser,
      password,
      database: a.dbName,
    })

    return { state: 'done' }
  },
}

async function resolveAppPassword(ctx: Context): Promise<string | null> {
  const fromEnv = process.env.BYLINE_DB_PASSWORD
  if (fromEnv) {
    if (fromEnv.length < 8) {
      ctx.logger.error('BYLINE_DB_PASSWORD must be at least 8 characters')
      return null
    }
    ctx.logger.info('using app role password from BYLINE_DB_PASSWORD')
    return fromEnv
  }
  const pw = await ctx.prompter.password({
    message: 'Choose a password for the application database role (min 8 chars)',
    validate: (v) => (v.length < 8 ? 'must be at least 8 characters' : undefined),
  })
  return pw || null
}

interface ProvisionArgs {
  sup: ReturnType<typeof parsePgUrl>
  dbName: string
  dbUser: string
  password: string
  reset: boolean
}

async function provisionRoleAndDatabase(ctx: Context, args: ProvisionArgs): Promise<void> {
  const { sup, dbName, dbUser, password, reset } = args
  const client = new Client({ connectionString: buildPgUrl(sup) })
  await client.connect()
  try {
    const dbUserIdent = client.escapeIdentifier(dbUser)
    const dbNameIdent = client.escapeIdentifier(dbName)

    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [dbUser])
    if ((roleExists.rowCount ?? 0) === 0) {
      ctx.logger.step(`creating role ${dbUser}`)
      await client.query(`CREATE ROLE ${dbUserIdent} WITH LOGIN`)
    } else {
      ctx.logger.step(`role ${dbUser} already exists`)
    }
    await client.query(`ALTER ROLE ${dbUserIdent} WITH PASSWORD ${client.escapeLiteral(password)}`)

    if (reset) {
      ctx.logger.step(`terminating connections to ${dbName}`)
      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      )
      ctx.logger.step(`dropping database ${dbName}`)
      await client.query(`DROP DATABASE IF EXISTS ${dbNameIdent}`)
    }

    const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if ((dbExists.rowCount ?? 0) === 0) {
      ctx.logger.step(`creating database ${dbName}`)
      await client.query(`CREATE DATABASE ${dbNameIdent} WITH OWNER ${dbUserIdent}`)
    } else {
      ctx.logger.step(`database ${dbName} already exists — reusing`)
    }
  } finally {
    await client.end().catch(() => {})
  }
}

async function installExtensions(ctx: Context, conn: ReturnType<typeof parsePgUrl>): Promise<void> {
  const client = new Client({ connectionString: buildPgUrl(conn) })
  await client.connect()
  try {
    for (const ext of REQUIRED_EXTENSIONS) {
      const ident = client.escapeIdentifier(ext)
      ctx.logger.step(`CREATE EXTENSION IF NOT EXISTS ${ext}`)
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${ident}`)
    }
  } finally {
    await client.end().catch(() => {})
  }
}

interface MigrateArgs {
  host: string
  port: number
  user: string
  password: string
  database: string
}

async function runMigrations(ctx: Context, args: MigrateArgs): Promise<void> {
  const migrationsFolder = resolve(ctx.templatesDir(), 'migrations')
  ctx.logger.step(`running migrations from ${migrationsFolder}`)
  const client = new Client({ connectionString: buildPgUrl(args) })
  await client.connect()
  try {
    const db = drizzle(client)
    await migrate(db, { migrationsFolder })
    const r = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'public'`
    )
    ctx.logger.success(`migrations applied — ${r.rows[0]?.count} tables in public schema`)
  } finally {
    await client.end().catch(() => {})
  }
}
