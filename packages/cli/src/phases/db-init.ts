import { databaseAdapterDefinition } from '../lib/database/adapters.js'
import {
  databaseIdentifierRequirement,
  databaseProvisioner,
  isValidDatabaseIdentifier,
} from '../lib/database/provisioner.js'
import { classifyDbTarget, type DbTargetState } from '../lib/database/state.js'
import { buildDbUrl, parseDbUrl } from '../lib/database/urls.js'
import { CLI_PACKAGE_VERSION } from '../lib/release-policy.js'
import type { Context } from '../context.js'
import type { DatabaseAdapterId, Phase } from '../types.js'

export const dbInitPhase: Phase = {
  id: 'db-init',
  title: 'Database initialization — provision user + database and apply the fresh baseline',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.cliFlags.existingDatabase) return ctx.secrets.applicationUrl ? 'pending' : 'blocked'
    if (ctx.state.isComplete('db-init')) return 'done'
    const answers = ctx.state.get().answers
    if (!answers.dbAdapter || !answers.dbName || !answers.dbUser || !answers.dbHost) {
      return 'blocked'
    }
    return 'pending'
  },

  async plan(ctx) {
    const answers = ctx.state.get().answers
    if (ctx.cliFlags.existingDatabase)
      return {
        writes: [],
        commands: [],
        notes: ['verify or install core storage on the existing PostgreSQL target'],
      }
    const notes: string[] = []
    if (answers.dbAdapter) notes.push(`database adapter: ${answers.dbAdapter}`)
    if (answers.dbName) notes.push(`provision database "${answers.dbName}"`)
    if (answers.dbUser) notes.push(`provision database user "${answers.dbUser}"`)
    if (ctx.reset) {
      notes.push('--reset: existing database will be DROPPED if present')
    } else {
      notes.push('non-destructive: existing database/user will be reused')
      notes.push('inspect the database first; stop without mutation unless it is empty')
    }
    if (answers.dbAdapter) {
      const prerequisites = databaseAdapterDefinition(answers.dbAdapter).prerequisites
      if (prerequisites.length > 0) {
        notes.push(`install prerequisites: ${prerequisites.join(', ')}`)
      }
    }
    if (answers.dbAdapter) {
      notes.push(`apply the adapter-owned ${answers.dbAdapter} fresh-install baseline`)
    }
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const answers = ctx.state.get().answers
    const adapter = answers.dbAdapter
    if (ctx.cliFlags.existingDatabase) {
      if (adapter !== 'postgres' || ctx.reset || !ctx.secrets.applicationUrl)
        return { state: 'blocked' }
      await databaseProvisioner(adapter, ctx.provisioners).applyBaseline({
        applicationUrl: ctx.secrets.applicationUrl,
        logger: ctx.logger,
      })
      return { state: 'done' }
    }
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
    const adminUrl = await resolveAdminUrl(ctx, adapter, answers.dbHost, answers.dbPort)
    if (!adminUrl) return { state: 'blocked' }

    const adminConnection = parseDbUrl(adminUrl, adapter)
    const applicationPort = answers.dbPort ?? definition.url.defaultPort
    const adminPort = adminConnection.port ?? definition.url.defaultPort
    if (
      normalizeHost(adminConnection.host) !== normalizeHost(answers.dbHost) ||
      adminPort !== applicationPort
    ) {
      ctx.logger.error(
        'administrator and application connection endpoints must use the same database host and port'
      )
      ctx.logger.info(
        `application endpoint: ${answers.dbHost}:${applicationPort}; administrator endpoint: ${adminConnection.host}:${adminPort}`
      )
      ctx.logger.info(
        'use an administrator URL for the same endpoint that will be written to the application environment'
      )
      return { state: 'blocked' }
    }

    const provisioner = databaseProvisioner(adapter, ctx.provisioners)

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

    let resumeOnly = false
    if (!ctx.reset) {
      ctx.logger.step(`inspecting database "${answers.dbName}" before any mutation`)
      const inspection = await provisioner.inspectTarget(adminUrl, answers.dbName)
      resumeOnly = adapter === 'mysql' && inspection.interruptedInstall === true
      const targetState = classifyDbTarget(inspection, adapter)
      if (!resumeOnly && (targetState === 'byline-schema' || targetState === 'occupied-schema')) {
        refuseOccupiedTarget(ctx, adapter, answers.dbName, targetState)
        return { state: 'blocked' }
      }
    }

    const password = await resolveAppPassword(ctx, definition.label, resumeOnly)
    if (!password) return { state: 'blocked' }
    ctx.secrets.dbPassword = password

    await provisioner.verifyBaselineAssets?.()
    if (!resumeOnly)
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
      port: applicationPort,
      user: answers.dbUser,
      password,
      database: answers.dbName,
    })
    await provisioner.applyBaseline({
      applicationUrl,
      resumeOnly,
      logger: ctx.logger,
    })

    return { state: 'done' }
  },
}

export function nativeSqlUpgradeUrl(adapter: DatabaseAdapterId): string {
  return `https://github.com/Byline-CMS/bylinecms.dev/blob/v${CLI_PACKAGE_VERSION}/packages/db-${adapter}/sql/README.md`
}

function refuseOccupiedTarget(
  ctx: Context,
  adapter: DatabaseAdapterId,
  database: string,
  state: Extract<DbTargetState, 'byline-schema' | 'occupied-schema'>
): void {
  if (state === 'byline-schema') {
    ctx.logger.error(
      `refusing fresh baseline: database "${database}" already contains Byline schema objects`
    )
    ctx.logger.info(
      'the squashed baseline creates the target release schema from scratch; it is not an upgrade stream'
    )
    ctx.logger.info(
      `upgrade the existing installation with native SQL for the target release: ${nativeSqlUpgradeUrl(adapter)}`
    )
    if (adapter === 'postgres')
      ctx.logger.info(
        'Inspect this database with byline storage status. Fence writers before byline storage adopt or byline storage migrate.'
      )
    ctx.logger.info(
      'only when destroying and rebuilding this Byline installation is intended, run: byline setup --force --reset --i-mean-it'
    )
  } else {
    ctx.logger.error(
      `refusing fresh baseline: database "${database}" contains existing tables or views`
    )
    ctx.logger.info(
      'the installer requires a dedicated empty database/schema and will not merge Byline into occupied application storage'
    )
    ctx.logger.info('choose a different, empty database name and run setup again')
  }
}

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase()
}

async function resolveAdminUrl(
  ctx: Context,
  adapter: DatabaseAdapterId,
  host: string,
  port?: number
): Promise<string | null> {
  const suppliedUrl =
    ctx.secrets.adminUrl ??
    (adapter === 'postgres'
      ? process.env.BYLINE_CLI_POSTGRES_ADMIN_URL
      : process.env.BYLINE_CLI_MYSQL_ADMIN_URL)
  if (suppliedUrl) {
    try {
      parseDbUrl(suppliedUrl, adapter)
      return suppliedUrl
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

async function resolveAppPassword(
  ctx: Context,
  databaseLabel: string,
  resumeOnly: boolean
): Promise<string | null> {
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
    message: resumeOnly
      ? `Enter the existing ${databaseLabel} login password to resume installation`
      : `Choose a password for that ${databaseLabel} database login (min 8 chars)`,
    validate: (value) => (value.length < 8 ? 'must be at least 8 characters' : undefined),
  })
  return password || null
}
