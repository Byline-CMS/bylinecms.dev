import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from 'pg'
import { expect } from 'vitest'

interface Target {
  host: Client
  url: URL
  database: string
  role: string
  cwd: string
}
export async function withTarget(use: (target: Target) => Promise<void>) {
  const url = new URL(process.env.BYLINE_CLI_POSTGRES_ADMIN_URL ?? '')
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== (process.env.BYLINE_CLI_TEST_POSTGRES_PORT ?? '5432') ||
    url.pathname !== '/postgres'
  ) {
    throw new Error('Coexistence fixture requires the loopback PostgreSQL test administrator')
  }
  const id = randomBytes(5).toString('hex')
  const database = `byline_cli_coexist_${id}_test`
  const role = `byline_install_${id}_test`
  const password = randomBytes(16).toString('hex')
  const admin = new Client({ connectionString: url.href })
  url.pathname = `/${database}`
  const host = new Client({ connectionString: url.href })
  url.username = role
  url.password = password
  const cwd = mkdtempSync(join(tmpdir(), 'byline-coexist-'))
  let createdRole = false
  let createdDatabase = false
  try {
    await admin.connect()
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD ${admin.escapeLiteral(password)}`)
    createdRole = true
    await admin.query(`CREATE DATABASE ${database}`)
    createdDatabase = true
    await host.connect()
    const info = await host.query('SELECT current_database() AS db, version() AS server')
    expect(info.rows[0].db).toBe(database)
    console.info(info.rows[0].db, info.rows[0].server)
    await host.query('CREATE EXTENSION pgcrypto')
    await host.query(`GRANT CREATE, USAGE ON SCHEMA public TO ${role}`)
    await host.query('CREATE TABLE host_sentinel (id integer PRIMARY KEY)')
    await host.query('INSERT INTO host_sentinel VALUES (42)')
    await use({ host, url, database, role, cwd })
  } finally {
    await host.end()
    try {
      if (createdDatabase) await admin.query(`DROP DATABASE ${database}`)
      if (createdRole) await admin.query(`DROP ROLE ${role}`)
    } finally {
      await admin.end()
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}
