import { createRequire } from 'node:module'

import { Client } from 'pg'

import { CLI_PACKAGE_VERSION } from '../release-policy.js'
import { databaseAdapterDefinition } from './adapters.js'
import { buildDbUrl, parseDbUrl, withDbDatabase } from './urls.js'
import type {
  BaselineArgs,
  DbProvisioner,
  DbTargetInspection,
  ProvisionArgs,
} from './provisioner.js'

async function migrations() {
  const { version } = createRequire(import.meta.url)('@byline/db-postgres/package.json')
  if (version !== CLI_PACKAGE_VERSION)
    throw new Error(
      `CLI ${CLI_PACKAGE_VERSION} requires its matching PostgreSQL adapter; resolved ${version}`
    )
  return import('@byline/db-postgres/migrations')
}

export const postgresProvisioner: DbProvisioner = {
  adapter: 'postgres',

  async verifyBaselineAssets() {
    const { verifyStorageMigrations } = await migrations()
    verifyStorageMigrations()
  },

  async verifyAdminConnection(adminUrl) {
    const connectionString = normalizedAdminUrl(adminUrl)
    const client = new Client({ connectionString })
    await client.connect()
    try {
      const result = await client.query<{ version: string }>('SELECT version() AS version')
      return result.rows[0]?.version ?? 'PostgreSQL (version unavailable)'
    } finally {
      await client.end().catch(() => {})
    }
  },

  async inspectTarget(adminUrl, database): Promise<DbTargetInspection> {
    const adminConnection = parseAdminUrl(adminUrl)
    const admin = new Client({ connectionString: buildDbUrl('postgres', adminConnection) })
    await admin.connect()
    try {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
      if ((exists.rowCount ?? 0) === 0) return { exists: false, objects: [] }
    } finally {
      await admin.end().catch(() => {})
    }

    const target = new Client({
      connectionString: buildDbUrl('postgres', withDbDatabase(adminConnection, database)),
    })
    await target.connect()
    try {
      const result = await target.query<{ name: string }>(
        `SELECT relname AS name FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace
         UNION SELECT typname FROM pg_catalog.pg_type WHERE typnamespace='public'::regnamespace
         UNION SELECT nspname FROM pg_catalog.pg_namespace
           WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3) <> 'pg_'
         ORDER BY name`
      )
      return { exists: true, objects: result.rows.map((row) => row.name) }
    } finally {
      await target.end().catch(() => {})
    }
  },

  async provisionTarget(args) {
    await provisionPostgresTarget(args)
  },

  async applyBaseline(args) {
    await applyPostgresBaseline(args)
  },
}

export function postgresRoleStatements(
  escaper: Pick<Client, 'escapeIdentifier' | 'escapeLiteral'>,
  user: string,
  password: string
): { create: string; alter: string } {
  const identifier = escaper.escapeIdentifier(user)
  return {
    create: `CREATE ROLE ${identifier} WITH LOGIN`,
    alter: `ALTER ROLE ${identifier} WITH PASSWORD ${escaper.escapeLiteral(password)}`,
  }
}

async function provisionPostgresTarget(args: ProvisionArgs): Promise<void> {
  const adminConnection = parseAdminUrl(args.adminUrl)
  const client = new Client({ connectionString: buildDbUrl('postgres', adminConnection) })
  await client.connect()
  try {
    const userIdentifier = client.escapeIdentifier(args.user)
    const databaseIdentifier = client.escapeIdentifier(args.database)
    const roleStatements = postgresRoleStatements(client, args.user, args.password)

    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [args.user])
    if ((roleExists.rowCount ?? 0) === 0) {
      args.logger.step(`creating role ${args.user}`)
      await client.query(roleStatements.create)
    } else {
      args.logger.step(`role ${args.user} already exists`)
    }
    await client.query(roleStatements.alter)

    if (args.reset) {
      args.logger.step(`terminating connections to ${args.database}`)
      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [args.database]
      )
      args.logger.step(`dropping database ${args.database}`)
      await client.query(`DROP DATABASE IF EXISTS ${databaseIdentifier}`)
    }

    const databaseExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      args.database,
    ])
    if ((databaseExists.rowCount ?? 0) === 0) {
      args.logger.step(`creating database ${args.database}`)
      await client.query(`CREATE DATABASE ${databaseIdentifier} WITH OWNER ${userIdentifier}`)
    } else {
      args.logger.step(`database ${args.database} already exists — assigning owner`)
      await client.query(`ALTER DATABASE ${databaseIdentifier} OWNER TO ${userIdentifier}`)
    }
  } finally {
    await client.end().catch(() => {})
  }

  const target = new Client({
    connectionString: buildDbUrl('postgres', withDbDatabase(adminConnection, args.database)),
  })
  await target.connect()
  try {
    const userIdentifier = target.escapeIdentifier(args.user)
    await target.query(`GRANT ALL ON SCHEMA public TO ${userIdentifier}`)
    for (const extension of databaseAdapterDefinition('postgres').prerequisites) {
      args.logger.step(`CREATE EXTENSION IF NOT EXISTS ${extension}`)
      await target.query(`CREATE EXTENSION IF NOT EXISTS ${target.escapeIdentifier(extension)}`)
    }
  } finally {
    await target.end().catch(() => {})
  }
}

async function applyPostgresBaseline(args: BaselineArgs): Promise<void> {
  const { installCoreStorage } = await migrations()
  const result = await installCoreStorage(args.applicationUrl)
  args.logger.success(
    result.applied.length
      ? `installed core storage versions ${result.applied.join(', ')}`
      : 'verified PostgreSQL core storage'
  )
}

function normalizedAdminUrl(raw: string): string {
  return buildDbUrl('postgres', parseAdminUrl(raw))
}

function parseAdminUrl(raw: string) {
  const parsed = parseDbUrl(raw, 'postgres')
  const database = parsed.database || databaseAdapterDefinition('postgres').defaultAdminDatabase
  return withDbDatabase(parsed, database)
}
