import { baselineDir } from '../lib/baseline.js'
import { databaseAdapterDefinition } from '../lib/database/adapters.js'
import {
  databaseIdentifierRequirement,
  databaseProvisioner,
  isValidDatabaseIdentifier,
} from '../lib/database/provisioner.js'
import { buildDbUrl, parseDbUrl } from '../lib/database/urls.js'
import type { Context } from '../context.js'
import type { DatabaseAdapterId, Phase } from '../types.js'

export const dbInitPhase: Phase = {
  id: 'db-init',
  title: 'Database initialization — provision user + database and apply the fresh baseline',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.state.isComplete('db-init')) return 'done'
    const answers = ctx.state.get().answers
    if (!answers.dbAdapter || !answers.dbName || !answers.dbUser || !answers.dbHost) {
      return 'blocked'
    }
    return 'pending'
  },

  async plan(ctx) {
    const answers = ctx.state.get().answers
    const notes: string[] = []
    if (answers.dbAdapter) notes.push(`database adapter: ${answers.dbAdapter}`)
    if (answers.dbName) notes.push(`provision database "${answers.dbName}"`)
    if (answers.dbUser) notes.push(`provision database user "${answers.dbUser}"`)
    if (ctx.reset) {
      notes.push('--reset: existing database will be DROPPED if present')
    } else {
      notes.push('non-destructive: existing database/user will be reused')
    }
    if (answers.dbAdapter === 'postgres') notes.push('install extension: pgcrypto')
    if (answers.dbAdapter) {
      notes.push(`apply the bundled ${answers.dbAdapter} fresh-install baseline`)
    }
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const answers = ctx.state.get().answers
    const adapter = answers.dbAdapter
    if (!adapter || !answers.dbName || !answers.dbUser || !answers.dbHost) {
      ctx.logger.error('db-init prerequisites missing — run the db phase first')
      return { state: 'blocked' }
    }
    if (!isValidDatabaseIdentifier(adapter, 'database', answers.dbName)) {
      ctx.logger.error(
        `invalid database name in state — ${databaseIdentifierRequirement(adapter, 'database')}`
      )
      return { state: 'blocked' }
    }
    if (!isValidDatabaseIdentifier(adapter, 'user', answers.dbUser)) {
      ctx.logger.error(
        `invalid database user in state — ${databaseIdentifierRequirement(adapter, 'user')}`
      )
      return { state: 'blocked' }
    }

    const definition = databaseAdapterDefinition(adapter)
    if (definition.baseline !== 'drizzle-sql') {
      ctx.logger.error(`${definition.label} does not support a Drizzle SQL baseline`)
      return { state: 'blocked' }
    }

    const adminUrl = await resolveAdminUrl(ctx, adapter, answers.dbHost, answers.dbPort)
    if (!adminUrl) return { state: 'blocked' }

    const password = await resolveAppPassword(ctx, definition.label)
    if (!password) return { state: 'blocked' }
    ctx.secrets.dbPassword = password

    if (ctx.reset && !ctx.resetConfirmed) {
      const ok = await ctx.prompter.confirm({
        message: `RESET will DROP database "${answers.dbName}" if it exists. Continue?`,
        defaultValue: false,
      })
      if (!ok) {
        ctx.logger.info('reset cancelled')
        return { state: 'blocked' }
      }
    }

    const provisioner = databaseProvisioner(adapter, ctx.provisioners)
    await provisioner.provisionTarget({
      adminUrl,
      database: answers.dbName,
      user: answers.dbUser,
      password,
      reset: ctx.reset,
      logger: ctx.logger,
    })

    const applicationUrl = buildDbUrl(adapter, {
      host: answers.dbHost,
      port: answers.dbPort ?? definition.url.defaultPort,
      user: answers.dbUser,
      password,
      database: answers.dbName,
    })
    await provisioner.applyBaseline({
      applicationUrl,
      migrationsFolder: baselineDir(ctx.templatesDir(), adapter),
      logger: ctx.logger,
    })

    return { state: 'done' }
  },
}

async function resolveAdminUrl(
  ctx: Context,
  adapter: DatabaseAdapterId,
  host: string,
  port?: number
): Promise<string | null> {
  if (ctx.secrets.adminUrl) {
    try {
      parseDbUrl(ctx.secrets.adminUrl, adapter)
      return ctx.secrets.adminUrl
    } catch (error) {
      ctx.logger.error((error as Error).message)
      return null
    }
  }

  const definition = databaseAdapterDefinition(adapter)
  const adminUser = adapter === 'postgres' ? 'postgres' : 'root'
  const fallback = buildDbUrl(adapter, {
    host,
    port: port ?? definition.url.defaultPort,
    user: adminUser,
    password: adminUser,
    database: definition.defaultAdminDatabase,
  })
  const url = await ctx.prompter.text({
    message: `${definition.label} administrator connection URL (used for user/database creation)`,
    placeholder: fallback,
    defaultValue: fallback,
  })
  if (!url) {
    ctx.logger.error('administrator URL is required to provision the user and database')
    return null
  }
  try {
    parseDbUrl(url, adapter)
  } catch (error) {
    ctx.logger.error((error as Error).message)
    return null
  }
  ctx.secrets.adminUrl = url
  return url
}

async function resolveAppPassword(ctx: Context, databaseLabel: string): Promise<string | null> {
  if (ctx.secrets.dbPassword) return ctx.secrets.dbPassword
  const fromEnv = process.env.BYLINE_DB_PASSWORD
  if (fromEnv) {
    if (fromEnv.length < 8) {
      ctx.logger.error('BYLINE_DB_PASSWORD must be at least 8 characters')
      return null
    }
    ctx.logger.info('using app database user password from BYLINE_DB_PASSWORD')
    return fromEnv
  }
  const password = await ctx.prompter.password({
    message: `Choose a password for the ${databaseLabel} application user (min 8 chars)`,
    validate: (value) => (value.length < 8 ? 'must be at least 8 characters' : undefined),
  })
  return password || null
}
