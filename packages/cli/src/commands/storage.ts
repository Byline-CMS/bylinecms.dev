import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

import type { StorageStatus as MysqlStatus } from '@byline/db-mysql/migrations'
import type { StorageStatus as PostgresStatus } from '@byline/db-postgres/migrations'
import type { Command } from 'commander'
import { valid } from 'semver'

import { mysqlMigrations } from '../lib/database/mysql.js'
import { postgresMigrations } from '../lib/database/postgres.js'
import { inspectAdapterSelection } from '../lib/database/selection.js'
import { CLI_PACKAGE_VERSION } from '../lib/release-policy.js'
import { createPrompter } from '../prompts.js'
import { StateStore } from '../state.js'

type Operation = 'status' | 'adopt' | 'migrate'
interface Options {
  yes?: boolean
  onlineOnly?: boolean
  deployedAdapterVersion?: string[]
  database?: string
  targetAdapterVersion?: string
}

type StorageStatus = PostgresStatus | MysqlStatus

function hostVersion(cwd: string, dialect: 'postgres' | 'mysql') {
  const manifest = resolve(cwd, 'package.json')
  if (!existsSync(manifest)) return { version: undefined, declared: false }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const name = `@byline/db-${dialect}`
  const declared = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].some((group) => Object.hasOwn(pkg[group] ?? {}, name))
  let path: string
  try {
    path = createRequire(manifest).resolve(`${name}/package.json`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    return { version: undefined, declared }
  }
  const adapter = JSON.parse(readFileSync(path, 'utf8'))
  if (adapter.name !== name || typeof adapter.version !== 'string')
    throw new Error(`Invalid host ${dialect} adapter metadata`)
  return { version: adapter.version as string, declared }
}

function printStatus(status: StorageStatus) {
  console.log(
    `${status.dialect} ${status.database}${status.dialect === 'postgres' ? '.public' : ''}: ${status.state} (${status.inspection}); observed ${status.observed ?? 'unknown'}, target ${status.target}, pending ${status.pending.join(', ') || 'none'}.`
  )
  console.log(
    `Server ${status.dialect === 'postgres' ? `major ${status.serverMajor ?? 'unknown'}` : (status.serverVersion ?? 'unknown')}; supported for storage commands: ${status.supportedServerMajors}.`
  )
  // Adapters write some observations as full sentences; avoid printing "..".
  for (const finding of status.findings)
    console.log(`${finding.check}: ${finding.observed.replace(/\.$/, '')}. ${finding.remedy}`)
  if (status.dialect === 'mysql' && status.formatNote) console.log(status.formatNote)
  console.log(status.next)
}

async function runStorage(operation: Operation, options: Options) {
  const cwd = process.cwd()
  const selection = inspectAdapterSelection(
    new StateStore(cwd).get().answers.dbAdapter,
    options.database
  )
  if (selection.state === 'blocked') throw new Error(selection.reason)
  const dialect = selection.adapter ?? 'postgres'
  const label = dialect === 'postgres' ? 'PostgreSQL' : 'MySQL'
  const protocols = dialect === 'postgres' ? ['postgresql:', 'postgres:'] : ['mysql:']
  const key =
    dialect === 'postgres'
      ? 'BYLINE_DB_POSTGRES_CONNECTION_STRING'
      : 'BYLINE_DB_MYSQL_CONNECTION_STRING'
  const path = resolve(cwd, '.env.local')
  const url =
    process.env[key] ?? (existsSync(path) ? parseEnv(readFileSync(path, 'utf8'))[key] : undefined)
  if (!url) throw new Error(`Set ${key} for the target database.`)
  const endpoint = new URL(url)
  if (!protocols.includes(endpoint.protocol) || endpoint.pathname.length < 2)
    throw new Error(`Expected a ${label} connection URL with a database name.`)
  const host = hostVersion(cwd, dialect)
  const adapter = dialect === 'postgres' ? await postgresMigrations() : await mysqlMigrations()
  const target = decodeURIComponent(endpoint.pathname.slice(1))
  const targetName = dialect === 'postgres' ? `${target}.public` : target
  console.log(
    `${label} ${targetName} — CLI adapter ${CLI_PACKAGE_VERSION}; host adapter ${host.version ?? (host.declared ? 'declared but unresolved' : 'standalone')}.`
  )
  if (operation === 'status') {
    const status = await adapter.inspectCoreStorage(url)
    printStatus(status)
    const codes: Partial<Record<StorageStatus['state'], number>> = {
      current: 0,
      pending: 2,
      recognized: 3,
      empty: 4,
      unrelated: 4,
    }
    process.exitCode = codes[status.state] ?? 1
    return
  }
  if (host.declared && !host.version)
    throw new Error('Install the declared host adapter before a storage mutation.')
  if (
    options.targetAdapterVersion !== undefined &&
    options.targetAdapterVersion !== CLI_PACKAGE_VERSION
  )
    throw new Error(
      `--target-adapter-version must exactly match the CLI adapter ${CLI_PACKAGE_VERSION}.`
    )
  if (options.onlineOnly && options.targetAdapterVersion)
    throw new Error('--target-adapter-version is available only for a fenced deployment.')
  if (options.deployedAdapterVersion?.length && !options.onlineOnly)
    throw new Error('--deployed-adapter-version requires --online-only.')
  if (
    host.version &&
    host.version !== CLI_PACKAGE_VERSION &&
    options.targetAdapterVersion !== CLI_PACKAGE_VERSION
  )
    throw new Error(
      'Host adapter version mismatch. For a fenced deployment supply --target-adapter-version matching the CLI-owned adapter.'
    )
  if (options.onlineOnly) {
    const directUrl = process.env.BYLINE_MIGRATION_DATABASE_URL
    if (!directUrl)
      throw new Error(
        'Set BYLINE_MIGRATION_DATABASE_URL to the verified direct/session endpoint for this deployment.'
      )
    const direct = new URL(directUrl)
    if (!protocols.includes(direct.protocol) || direct.pathname.length < 2)
      throw new Error(`Expected a direct ${label} URL with a database name.`)
    const deployedReleases = options.deployedAdapterVersion ?? []
    if (deployedReleases.some((v) => !valid(v)))
      throw new Error('Supply exact deployed adapter versions from release inventory.')
    const { applied } = await adapter.migrateCoreStorageOnline({
      directUrl,
      runtimeUrl: url,
      deployedReleases,
      report(plan) {
        console.log(
          `Target core ${plan.target}; deployed adapter releases: ${plan.deployedReleases.join(', ') || 'none declared'}.`
        )
        for (const step of plan.pending)
          console.log(
            `Pending ${step.version}: ${step.classification}; tested adapter releases: ${step.testedReleases.join(', ') || 'none'}.`
          )
      },
    })
    console.log(
      applied.length
        ? `Applied online migrations ${applied.join(', ')}.`
        : 'Core storage is current.'
    )
    return
  }
  const preview = await adapter.inspectCoreStorage(url)
  printStatus(preview)
  const admissible =
    operation === 'adopt' ? ['recognized', 'current', 'pending'] : ['pending', 'current']
  const recovering =
    dialect === 'mysql' &&
    operation === 'migrate' &&
    preview.state === 'interrupted' &&
    preview.findings.some((f) => f.check === 'upgrade-stage')
  if (!recovering && !admissible.includes(preview.state))
    throw new Error(`Cannot ${operation}: ${preview.state}. ${preview.next}`)
  console.log(
    `Supervised ${operation} requires fenced writers and workers and a verified backup. Deploy matching adapter ${CLI_PACKAGE_VERSION} before reopening traffic.`
  )
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        'Supervised storage mutations require an interactive confirmation or --yes after fencing all writers.'
      )
    const versions =
      operation === 'adopt'
        ? `observed checkpoint ${preview.observed}`
        : `pending versions ${preview.pending.join(', ') || 'none'}`
    const confirmed = await createPrompter().confirm({
      message: `Confirm writers are fenced and a backup is available. ${operation} ${targetName} using adapter ${CLI_PACKAGE_VERSION}, ${versions}?`,
      defaultValue: false,
    })
    if (!confirmed) throw new Error('Storage operation cancelled.')
  }
  if (operation === 'adopt') {
    const result = await adapter.adoptCoreStorage(url)
    console.log(
      `Core checkpoint ${result.version} ${result.adopted ? 'adopted' : 'already recorded'}.`
    )
  } else {
    const { applied } = await adapter.migrateCoreStorage(url)
    console.log(
      applied.length ? `Applied core migrations ${applied.join(', ')}.` : 'Core storage is current.'
    )
  }
}

export function registerStorageCommands(program: Command) {
  const storage = program
    .command('storage')
    .description('Inspect, adopt and migrate core database storage')
  for (const operation of ['status', 'adopt', 'migrate'] as const) {
    const command = storage
      .command(operation)
      .description(
        {
          status: 'Inspect the database and report the next operator action',
          adopt: 'Record a verified existing checkpoint with writers fenced',
          migrate: 'Apply pending core migrations with writers fenced',
        }[operation]
      )
      .option('--database <adapter>', 'database adapter (postgres or mysql)')
    if (operation !== 'status')
      command.option(
        '--target-adapter-version <exact-release>',
        'explicit matching application release for a fenced deployment'
      )
    if (operation !== 'status')
      command.option('-y, --yes', 'confirm supervised operation after fencing and backup')
    if (operation === 'migrate')
      command
        .option(
          '--online-only',
          'run eligible steps in a direct release job while writers are live'
        )
        .option(
          '--deployed-adapter-version <exact-release>',
          'active writer/worker version (repeatable)',
          (value: string, prior: string[]) => [...prior, value],
          []
        )
    command.action((options: Options) => runStorage(operation, options))
  }
}
