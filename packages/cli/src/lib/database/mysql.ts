import { createRequire } from 'node:module'

import { type ConnectionOptions, escapeId, escape as escapeValue, type RowDataPacket } from 'mysql2'
import { type Connection, createConnection } from 'mysql2/promise'

import { CLI_PACKAGE_VERSION } from '../release-policy.js'
import { databaseAdapterDefinition } from './adapters.js'
import { parseDbUrl, withDbDatabase } from './urls.js'
import type { DbProvisioner, DbTargetInspection, ProvisionArgs } from './provisioner.js'

export async function mysqlMigrations() {
  const { version } = createRequire(import.meta.url)('@byline/db-mysql/package.json')
  if (version !== CLI_PACKAGE_VERSION)
    throw new Error(
      `CLI ${CLI_PACKAGE_VERSION} requires its matching MySQL adapter; resolved ${version}`
    )
  return import('@byline/db-mysql/migrations')
}

export const MYSQL_MINIMUM_VERSION = { major: 8, minor: 0, patch: 16 } as const

export const mysqlProvisioner: DbProvisioner = {
  adapter: 'mysql',

  async verifyBaselineAssets() {
    ;(await mysqlMigrations()).verifyStorageMigrations()
  },

  async verifyAdminConnection(adminUrl) {
    const connection = await connect(adminUrl)
    try {
      return `MySQL ${await verifiedServerVersion(connection)}`
    } finally {
      await connection.end()
    }
  },

  async inspectTarget(adminUrl, database): Promise<DbTargetInspection> {
    const connection = await connect(adminUrl)
    try {
      await verifiedServerVersion(connection)
      const [schemas] = await connection.query<RowDataPacket[]>(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
        [database]
      )
      if (schemas.length === 0) return { exists: false, objects: [] }

      const [objects] = await connection.query<Array<RowDataPacket & { name: string }>>(
        `SELECT TABLE_NAME AS name
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME`,
        [database]
      )
      const names = objects.map((row) => row.name)
      let interruptedInstall = false
      if (names.includes('byline_core_migrations')) {
        const target = new URL(adminUrl)
        target.pathname = database
        interruptedInstall = await (await mysqlMigrations()).hasInterruptedInstall(target.href)
      }
      return { exists: true, objects: names, interruptedInstall }
    } finally {
      await connection.end()
    }
  },

  async provisionTarget(args) {
    await provisionMysqlTarget(args)
  },

  async applyBaseline(args) {
    const result = await (await mysqlMigrations()).installCoreStorage(args.applicationUrl, {
      resumeOnly: args.resumeOnly,
    })
    args.logger.success(`MySQL core storage verified at version ${result.version}`)
  },
}

export function assertSupportedMySqlVersion(reported: unknown): asserts reported is string {
  if (typeof reported !== 'string' || reported.length === 0) {
    throw new Error(
      "@byline/cli: could not determine the MySQL server version — 'SELECT VERSION()' returned no usable result."
    )
  }
  if (/mariadb/i.test(reported)) throw unsupportedEngineError(reported)

  const match = reported.match(/^(\d+)\.(\d+)\.(\d+)/)
  const [major = 0, minor = 0, patch = 0] = match ? match.slice(1).map(Number) : []
  const supported =
    major > MYSQL_MINIMUM_VERSION.major ||
    (major === MYSQL_MINIMUM_VERSION.major &&
      (minor > MYSQL_MINIMUM_VERSION.minor ||
        (minor === MYSQL_MINIMUM_VERSION.minor && patch >= MYSQL_MINIMUM_VERSION.patch)))
  if (!supported) throw unsupportedEngineError(reported)
}

export function mysqlAccountSql(user: string): string {
  return `${escapeValue(user)}@${escapeValue('%')}`
}

export function mysqlProvisionStatements(args: {
  database: string
  user: string
  password: string
  createDatabase: boolean
}): string[] {
  const account = mysqlAccountSql(args.user)
  const database = escapeId(args.database)
  const statements = [
    `CREATE USER IF NOT EXISTS ${account}`,
    `ALTER USER ${account} IDENTIFIED BY ${escapeValue(args.password)}`,
  ]
  if (args.createDatabase) {
    statements.push(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  }
  statements.push(`GRANT ALL PRIVILEGES ON ${database}.* TO ${account}`)
  return statements
}

async function provisionMysqlTarget(args: ProvisionArgs): Promise<void> {
  const connection = await connect(args.adminUrl)
  try {
    await verifiedServerVersion(connection)
    const database = escapeId(args.database)
    if (args.reset) {
      args.logger.step(`dropping database ${args.database}`)
      await connection.query(`DROP DATABASE IF EXISTS ${database}`)
    }

    const [schemas] = await connection.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [args.database]
    )
    const createDatabase = schemas.length === 0
    for (const statement of mysqlProvisionStatements({
      database: args.database,
      user: args.user,
      password: args.password,
      createDatabase,
    })) {
      args.logger.step(statement.split(' ').slice(0, 3).join(' '))
      await connection.query(statement)
    }
  } finally {
    await connection.end()
  }
}

async function connect(raw: string): Promise<Connection> {
  return createConnection(connectionOptions(raw))
}

async function verifiedServerVersion(connection: Connection): Promise<string> {
  const [rows] =
    await connection.query<Array<RowDataPacket & { v?: unknown }>>('SELECT VERSION() AS v')
  const version = rows[0]?.v
  assertSupportedMySqlVersion(version)
  const migrations = await mysqlMigrations()
  await migrations.verifyCatalogFormat(connection)
  return version
}

function connectionOptions(raw: string): ConnectionOptions {
  const parsed = parseDbUrl(raw, 'mysql')
  const database = parsed.database || databaseAdapterDefinition('mysql').defaultAdminDatabase
  const connection = withDbDatabase(parsed, database)
  return {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    timezone: 'Z',
  }
}

function unsupportedEngineError(reported: string): Error {
  const minimum = MYSQL_MINIMUM_VERSION
  return new Error(
    `@byline/cli requires MySQL ${minimum.major}.${minimum.minor}.${minimum.patch}+ for @byline/db-mysql compatibility (LATERAL joins and enforced CHECK constraints); server reports ${reported}. MariaDB is not supported.`
  )
}
