import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installCoreStorage as installMysql } from '@byline/db-mysql/migrations'
import { installCoreStorage as installPostgres } from '@byline/db-postgres/migrations'
import { createConnection } from 'mysql2/promise'
import type { Client } from 'pg'
import { expect, it } from 'vitest'

import { definition, rows } from '../../db-mysql/dist/migrations/catalog.js'
import { readCutoverCatalog } from '../../db-postgres/dist/migrations/catalog.js'
import { withMysqlTarget } from './mysql-target.js'
import { withTarget } from './postgres-target.js'

// Generate from today's TypeScript schema into an empty directory. This also
// detects schema edits that have never been generated into a development diff.
function intended(dialect: 'postgres' | 'mysql') {
  const temp = mkdtempSync(join(tmpdir(), 'byline-drizzle-'))
  const adapter = fileURLToPath(new URL(`../../db-${dialect}/`, import.meta.url))
  try {
    execFileSync(
      join(adapter, 'node_modules/.bin/drizzle-kit'),
      [
        'generate',
        '--dialect',
        dialect === 'postgres' ? 'postgresql' : 'mysql',
        '--schema',
        './src/database/schema/index.ts',
        '--out',
        temp,
      ],
      { cwd: adapter, stdio: 'pipe' }
    )
    const files = readdirSync(temp).filter((name) => name.endsWith('.sql'))
    expect(files).toHaveLength(1)
    return readFileSync(join(temp, files[0]!), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

async function pgCatalog(client: Client) {
  await client.query('SET search_path TO pg_catalog')
  const { rows } = await client.query<{ name: string }>(
    `SELECT relname AS name FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','m','S','p','f') AND relname NOT IN ('host_sentinel','byline_core_migrations') ORDER BY relname`
  )
  return readCutoverCatalog(
    client,
    rows.map((r) => r.name)
  )
}

it(
  'compares the runner-built PostgreSQL catalog to the current Drizzle declarations',
  async () =>
    withTarget(async (fresh) =>
      withTarget(async (dev) => {
        await installPostgres(fresh.url.href)
        for (const sql of intended('postgres')) await dev.host.query(sql)
        expect(await pgCatalog(fresh.host)).toEqual(await pgCatalog(dev.host))
      })
    ),
  90000
)

it(
  'compares the runner-built MySQL catalog to the current Drizzle declarations',
  async () =>
    withMysqlTarget(async (fresh) =>
      withMysqlTarget(async (dev) => {
        await installMysql(fresh.href)
        const a = await createConnection(fresh.href),
          b = await createConnection(dev.href)
        try {
          for (const sql of intended('mysql')) await b.query(sql)
          const catalog = async (connection: typeof a, url: URL) => {
            const tables = await rows(
              connection,
              "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME <> 'byline_core_migrations' ORDER BY TABLE_NAME"
            )
            const objects: Record<string, string[]> = {}
            for (const table of tables)
              objects[table.name] = await definition(connection, url.pathname.slice(1), table.name)
            return objects
          }
          expect(await catalog(a, fresh)).toEqual(await catalog(b, dev))
        } finally {
          await a.end()
          await b.end()
        }
      })
    ),
  90000
)
