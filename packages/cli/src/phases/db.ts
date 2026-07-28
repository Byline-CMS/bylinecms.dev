import { databaseAdapterDefinition } from '../lib/database/adapters.js'
import {
  databaseIdentifierRequirement,
  databaseProvisioner,
  isValidDatabaseIdentifier,
} from '../lib/database/provisioner.js'
import { inspectDatabaseAdapter, resolveDatabaseAdapter } from '../lib/database/selection.js'
import { buildDbUrl, parseDbUrl } from '../lib/database/urls.js'
import type { Phase } from '../types.js'

export const dbPhase: Phase = {
  id: 'db',
  title: 'Database — choose strategy and verify connection',
  defaultMode: 'confirm',

  async detect(ctx) {
    const adapter = inspectDatabaseAdapter(ctx)
    if (adapter.state === 'blocked') return 'blocked'
    return ctx.state.isComplete('db') && adapter.state === 'resolved' ? 'done' : 'pending'
  },

  async plan(ctx) {
    const answers = ctx.state.get().answers
    const notes: string[] = []
    if (answers.dbAdapter) notes.push(`database adapter: ${answers.dbAdapter}`)
    else notes.push('will ask: PostgreSQL or MySQL?')
    if (answers.dbStrategy) notes.push(`strategy: ${answers.dbStrategy}`)
    if (answers.dbHost) notes.push(`host: ${answers.dbHost}:${answers.dbPort}`)
    if (answers.dbName) notes.push(`database: ${answers.dbName}`)
    if (answers.dbUser) notes.push(`database user: ${answers.dbUser}`)
    if (notes.length === 0) notes.push('will prompt for database connection details')
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const adapter = await resolveDatabaseAdapter(ctx)
    if (!adapter) return { state: 'blocked' }
    const definition = databaseAdapterDefinition(adapter)
    const provisioner = databaseProvisioner(adapter, ctx.provisioners)

    const strategy = await ctx.prompter.select({
      message: `How will Byline connect to ${definition.label}?`,
      options: [
        {
          value: 'existing',
          label: `I have a running ${definition.label} server and will provide credentials`,
        },
        { value: 'docker', label: 'Use the bundled docker-compose to spin one up' },
      ],
    })

    if (strategy === 'docker') {
      ctx.logger.warn('docker strategy is not supported yet — use --strategy existing')
      return { state: 'blocked' }
    }

    const adminUser = adapter === 'postgres' ? 'postgres' : 'root'
    const adminUrlDefault = buildDbUrl(adapter, {
      host: '127.0.0.1',
      port: definition.url.defaultPort,
      user: adminUser,
      password: adminUser,
      database: definition.defaultAdminDatabase,
    })
    const adminUrl = await ctx.prompter.text({
      message: `${definition.label} administrator connection URL (used for user/database creation)`,
      placeholder: adminUrlDefault,
      defaultValue: adminUrlDefault,
    })

    const dbName = await ctx.prompter.text({
      message: 'Database name to create',
      defaultValue: 'byline',
    })
    if (!isValidDatabaseIdentifier(adapter, 'database', dbName)) {
      ctx.logger.error(
        `invalid database name "${dbName}" — ${databaseIdentifierRequirement(adapter, 'database')}`
      )
      return { state: 'blocked' }
    }

    const dbUser = await ctx.prompter.text({
      message: `Application ${adapter === 'postgres' ? 'role' : 'database user'}`,
      defaultValue: 'byline',
    })
    if (!isValidDatabaseIdentifier(adapter, 'user', dbUser)) {
      ctx.logger.error(
        `invalid database user "${dbUser}" — ${databaseIdentifierRequirement(adapter, 'user')}`
      )
      return { state: 'blocked' }
    }

    let adminConnection: ReturnType<typeof parseDbUrl>
    try {
      adminConnection = parseDbUrl(adminUrl, adapter)
    } catch (error) {
      ctx.logger.error((error as Error).message)
      return { state: 'blocked' }
    }

    const spinner = ctx.prompter.spinner()
    const port = adminConnection.port ?? definition.url.defaultPort ?? 'adapter default'
    spinner.start(
      `testing ${definition.label} administrator connection to ${adminConnection.host}:${port}`
    )
    try {
      const version = await provisioner.verifyAdminConnection(adminUrl)
      spinner.stop(`connected — ${version}`)
    } catch (error) {
      spinner.stop('connection failed')
      ctx.logger.error((error as Error).message)
      return { state: 'blocked' }
    }

    // Administrator URLs carry privileged credentials and remain in memory.
    ctx.secrets.adminUrl = adminUrl
    ctx.state.patchAnswers({
      dbAdapter: adapter,
      dbStrategy: strategy,
      dbHost: adminConnection.host,
      dbPort: adminConnection.port ?? definition.url.defaultPort,
      dbName,
      dbUser,
    })
    ctx.logger.info(`will provision database "${dbName}" for user "${dbUser}"`)
    return { state: 'done' }
  },
}
