import { rmSync } from 'node:fs'

import { escapeId, escape as escapeValue, type RowDataPacket } from 'mysql2'
import { createConnection } from 'mysql2/promise'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { databaseProvisioner } from '../src/lib/database/provisioner.js'
import { classifyDbTarget } from '../src/lib/database/state.js'
import { dbInitPhase } from '../src/phases/db-init.js'
import { createTestContext } from '../src/test-helpers.js'
import type { Context } from '../src/context.js'
import type { DatabaseAdapterId } from '../src/types.js'
import type { Logger } from '../src/ui/logger.js'

const APP_PASSWORD = 'byline-cli-test-password'
const CANONICAL_TABLE = 'byline_documents'
const contexts: Context[] = []

const configurations = [
  {
    adapter: 'postgres',
    adminUrl: requiredEnv('BYLINE_CLI_POSTGRES_ADMIN_URL'),
    freshDatabase: 'byline_cli_pg_fresh_test',
    occupiedDatabase: 'byline_cli_pg_occupied_test',
    applicationUser: 'byline_cli_pg_test',
  },
  {
    adapter: 'mysql',
    adminUrl: requiredEnv('BYLINE_CLI_MYSQL_ADMIN_URL'),
    freshDatabase: 'byline_cli_mysql_fresh_test',
    occupiedDatabase: 'byline_cli_mysql_occupied_test',
    applicationUser: 'byline_cli_mysql_test',
  },
] as const satisfies readonly DatabaseSmokeConfiguration[]

beforeAll(async () => {
  for (const configuration of configurations) {
    assertEndpointShape(configuration)
    await cleanup(configuration)
    await createOccupiedTarget(configuration)
  }
})

afterAll(async () => {
  for (const configuration of configurations) {
    await cleanup(configuration)
  }
  for (const ctx of contexts.splice(0)) {
    rmSync(ctx.cwd, { recursive: true, force: true })
  }
})

describe.each(configurations)('$adapter CLI database installation', (configuration) => {
  it('applies a fresh baseline and refuses Byline or unrelated occupied targets', async () => {
    const fresh = testContext(configuration, configuration.freshDatabase)
    fresh.secrets.dbPassword = APP_PASSWORD
    expect((await dbInitPhase.apply(await dbInitPhase.plan(fresh), fresh)).state).toBe('done')
    expect(await tableExists(configuration, configuration.freshDatabase, CANONICAL_TABLE)).toBe(
      true
    )

    const provisioner = databaseProvisioner(configuration.adapter)
    expect(
      classifyDbTarget(
        await provisioner.inspectTarget(configuration.adminUrl, configuration.freshDatabase)
      )
    ).toBe('byline-schema')

    const bylineMessages: string[] = []
    const existingByline = testContext(configuration, configuration.freshDatabase, bylineMessages)
    expect(
      (await dbInitPhase.apply(await dbInitPhase.plan(existingByline), existingByline)).state
    ).toBe('blocked')
    expect(existingByline.secrets.dbPassword).toBeUndefined()
    expect(bylineMessages.join('\n')).toContain('refusing fresh baseline')

    expect(
      classifyDbTarget(
        await provisioner.inspectTarget(configuration.adminUrl, configuration.occupiedDatabase)
      )
    ).toBe('occupied-schema')

    const occupiedMessages: string[] = []
    const occupied = testContext(configuration, configuration.occupiedDatabase, occupiedMessages)
    expect((await dbInitPhase.apply(await dbInitPhase.plan(occupied), occupied)).state).toBe(
      'blocked'
    )
    expect(occupied.secrets.dbPassword).toBeUndefined()
    expect(occupiedMessages.join('\n')).toContain('contains existing tables or views')
    expect(await tableExists(configuration, configuration.occupiedDatabase, CANONICAL_TABLE)).toBe(
      false
    )

    if (configuration.adapter === 'postgres') {
      expect(await postgresExtensionExists(configuration, 'pgcrypto')).toBe(false)
    }
  })
})

interface DatabaseSmokeConfiguration {
  adapter: DatabaseAdapterId
  adminUrl: string
  freshDatabase: string
  occupiedDatabase: string
  applicationUser: string
}

function testContext(
  configuration: DatabaseSmokeConfiguration,
  database: string,
  messages: string[] = []
): Context {
  const endpoint = new URL(configuration.adminUrl)
  const ctx = createTestContext(
    {
      dbAdapter: configuration.adapter,
      dbHost: endpoint.hostname,
      dbPort: Number(endpoint.port),
      dbName: database,
      dbUser: configuration.applicationUser,
    },
    { logger: capturingLogger(messages) }
  )
  contexts.push(ctx)
  ctx.secrets.adminUrl = configuration.adminUrl
  return ctx
}

function assertEndpointShape(configuration: DatabaseSmokeConfiguration): void {
  const endpoint = new URL(configuration.adminUrl)
  expect(endpoint.hostname).toBe('127.0.0.1')
  expect(endpoint.port).toBe(configuration.adapter === 'postgres' ? '5432' : '3306')
}

async function createOccupiedTarget(configuration: DatabaseSmokeConfiguration): Promise<void> {
  if (configuration.adapter === 'postgres') {
    const admin = new Client({ connectionString: configuration.adminUrl })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(configuration.occupiedDatabase)}`)
    } finally {
      await admin.end()
    }

    const target = new Client({
      connectionString: postgresDatabaseUrl(configuration.adminUrl, configuration.occupiedDatabase),
    })
    await target.connect()
    try {
      await target.query('CREATE TABLE operator_data (id integer PRIMARY KEY)')
    } finally {
      await target.end()
    }
    return
  }

  const connection = await createConnection(configuration.adminUrl)
  try {
    await connection.query(`CREATE DATABASE ${escapeId(configuration.occupiedDatabase)}`)
    await connection.query(
      `CREATE TABLE ${escapeId(configuration.occupiedDatabase)}.operator_data (id integer PRIMARY KEY)`
    )
  } finally {
    await connection.end()
  }
}

async function tableExists(
  configuration: DatabaseSmokeConfiguration,
  database: string,
  table: string
): Promise<boolean> {
  if (configuration.adapter === 'postgres') {
    const target = new Client({
      connectionString: postgresDatabaseUrl(configuration.adminUrl, database),
    })
    await target.connect()
    try {
      const result = await target.query(
        `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      )
      return (result.rowCount ?? 0) > 0
    } finally {
      await target.end()
    }
  }

  const connection = await createConnection(configuration.adminUrl)
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT 1
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [database, table]
    )
    return rows.length > 0
  } finally {
    await connection.end()
  }
}

async function postgresExtensionExists(
  configuration: DatabaseSmokeConfiguration,
  extension: string
): Promise<boolean> {
  const target = new Client({
    connectionString: postgresDatabaseUrl(configuration.adminUrl, configuration.occupiedDatabase),
  })
  await target.connect()
  try {
    const result = await target.query('SELECT 1 FROM pg_extension WHERE extname = $1', [extension])
    return (result.rowCount ?? 0) > 0
  } finally {
    await target.end()
  }
}

async function cleanup(configuration: DatabaseSmokeConfiguration): Promise<void> {
  if (configuration.adapter === 'postgres') {
    const admin = new Client({ connectionString: configuration.adminUrl })
    await admin.connect()
    try {
      for (const database of [configuration.freshDatabase, configuration.occupiedDatabase]) {
        await admin.query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [database]
        )
        await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(database)}`)
      }
      await admin.query(
        `DROP ROLE IF EXISTS ${admin.escapeIdentifier(configuration.applicationUser)}`
      )
    } finally {
      await admin.end()
    }
    return
  }

  const connection = await createConnection(configuration.adminUrl)
  try {
    for (const database of [configuration.freshDatabase, configuration.occupiedDatabase]) {
      await connection.query(`DROP DATABASE IF EXISTS ${escapeId(database)}`)
    }
    await connection.query(
      `DROP USER IF EXISTS ${escapeValue(configuration.applicationUser)}@${escapeValue('%')}`
    )
  } finally {
    await connection.end()
  }
}

function postgresDatabaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${database}`
  return url.toString()
}

function capturingLogger(messages: string[]): Logger {
  const capture = (message: string) => messages.push(message)
  return {
    info: capture,
    warn: capture,
    error: capture,
    success: capture,
    step: capture,
    raw: capture,
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for @byline/cli integration tests`)
  return value
}
