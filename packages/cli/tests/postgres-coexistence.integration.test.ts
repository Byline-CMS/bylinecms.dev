import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installCoreStorage } from '@byline/db-postgres/migrations'
import { resetTestDatabase } from '@byline/db-postgres/testing'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import { loadStorageSteps } from '../../db-postgres/dist/migrations/assets.js'
// Test-only access to the same executor, without exposing arbitrary SQL to public callers.
import { installOnConnection } from '../../db-postgres/dist/migrations/runner.js'
import { postgresProvisioner } from '../src/lib/database/postgres.js'
import { dependencySpecsFor } from '../src/manifest/deps.js'
import { ENV_FILE_PATHS, envSpecsForAdapter } from '../src/manifest/env.js'
import { withTarget } from './postgres-target.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const legacyTimestamp = 1793427239806 // PostgreSQL v6.13.4 release baseline

type Order = 'host-first' | 'byline-first'
type InstallPath = 'provisioner' | 'cli'

function writeHostMigration(folder: string, timestamp: number, advance = false) {
  mkdirSync(join(folder, 'meta'), { recursive: true })
  const entries = [{ idx: 0, version: '7', when: timestamp, tag: '0000_host', breakpoints: true }]
  writeFileSync(join(folder, '0000_host.sql'), 'CREATE TABLE host_initial (id integer PRIMARY KEY)')
  if (advance) {
    entries.push({ idx: 1, version: '7', when: timestamp + 1, tag: '0001_host', breakpoints: true })
    writeFileSync(join(folder, '0001_host.sql'), 'CREATE TABLE host_next (id integer PRIMARY KEY)')
  }
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries })
  )
}

function prepareHost(cwd: string, applicationUrl: string) {
  const answers = { dbAdapter: 'postgres' } as const
  const dependencies = Object.fromEntries(
    dependencySpecsFor(answers)
      .filter((dep) => dep.group === 'byline')
      .map((dep) => [dep.name, dep.version])
  )
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'coexistence-fixture', dependencies })
  )
  mkdirSync(join(cwd, '.git'))
  for (const file of ['public', 'secret'] as const) {
    const lines = envSpecsForAdapter('postgres')
      .filter((spec) => spec.file === file)
      .map(
        (spec) =>
          `${spec.key}=${spec.key === 'BYLINE_DB_POSTGRES_CONNECTION_STRING' ? applicationUrl : 'fixture'}`
      )
    writeFileSync(join(cwd, ENV_FILE_PATHS[file]), lines.join('\n'), { mode: 0o600 })
  }
}

function runSetup(
  cwd: string,
  applicationUrl: string,
  flags: string[],
  env: NodeJS.ProcessEnv = {},
  expectedStatus = 0,
  seedAdmin = false
) {
  const result = spawnSync(
    process.execPath,
    [
      join(dist, 'cli.js'),
      'setup',
      ...flags,
      '--database',
      'postgres',
      '--apply',
      '--yes',
      '--pm',
      'npm',
      ...(seedAdmin ? [] : ['--no-seed-admin']),
      '--no-seed-docs',
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: 20_000,
      env: { PATH: process.env.PATH, BYLINE_DB_POSTGRES_CONNECTION_STRING: applicationUrl, ...env },
    }
  )
  if (result.error) throw result.error
  expect(result.status, result.stderr.replaceAll(applicationUrl, '[database URL]')).toBe(
    expectedStatus
  )
}

async function relation(client: Client, name: string) {
  const result = await client.query<{ name: string | null }>(
    'SELECT to_regclass($1)::text AS name',
    [name]
  )
  return result.rows[0]?.name
}

async function hostLedger(client: Client) {
  if (!(await relation(client, 'drizzle.__drizzle_migrations'))) return []
  return (
    await client.query('SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id')
  ).rows
}

async function exercise(order: Order, path: InstallPath) {
  await withTarget(async ({ host, url, database, role, cwd }) => {
    const folder = join(cwd, 'host-migrations')
    if (path === 'provisioner') {
      // Let the historical installer access the shared Drizzle journal so the silent
      // timestamp skip is observable independently of setup's occupied-target guard.
      await host.query(`GRANT CREATE ON DATABASE ${database} TO ${role}`)
    }
    const db = drizzle(host)
    const timestamp = legacyTimestamp + (order === 'host-first' ? 1000 : -1000)
    writeHostMigration(folder, timestamp)
    if (order === 'host-first') {
      await migrate(db, { migrationsFolder: folder })
      expect(await relation(host, 'host_initial')).toBe('host_initial')
      if (path === 'provisioner') {
        await host.query(`GRANT USAGE, CREATE ON SCHEMA drizzle TO ${role}`)
        await host.query(`GRANT SELECT, INSERT ON drizzle.__drizzle_migrations TO ${role}`)
        await host.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA drizzle TO ${role}`)
      }
    }
    const catalog = async () =>
      (
        await host.query<{ name: string }>(
          "SELECT relname AS name FROM pg_class WHERE relnamespace='public'::regnamespace"
        )
      ).rows.map((row) => row.name)
    const beforeObjects = await catalog()
    const before = await hostLedger(host)
    const sentinel = async () =>
      (
        await host.query(
          "SELECT id, pg_get_userbyid(relowner) AS owner, relacl::text AS acl FROM host_sentinel JOIN pg_class ON oid = 'host_sentinel'::regclass"
        )
      ).rows
    const sentinelBefore = await sentinel()

    if (path === 'cli') {
      prepareHost(cwd, url.href)
      runSetup(cwd, url.href, ['--existing-database'])
      runSetup(cwd, url.href, ['--reset', '--i-mean-it', '--force'], {}, 1)
      runSetup(cwd, url.href, [])
    } else {
      await postgresProvisioner.applyBaseline({
        applicationUrl: url.href,
        logger: { step() {}, success() {} },
      })
    }
    expect(
      await relation(host, 'byline_documents'),
      'Byline reported success but its document table is missing'
    ).toBe('byline_documents')
    const createdObjects = (await catalog()).filter((name) => !beforeObjects.includes(name)).sort()
    if (order === 'byline-first') {
      expect(await hostLedger(host)).toEqual([])
      expect((await host.query("SELECT to_regnamespace('drizzle') AS n")).rows[0].n).toBeNull()
      await migrate(db, { migrationsFolder: folder })
      expect(
        await relation(host, 'host_initial'),
        'Drizzle reported success but the older host migration was skipped'
      ).toBe('host_initial')
    } else {
      expect(await hostLedger(host)).toEqual(before)
    }
    const coreRows = async () =>
      (await host.query('SELECT * FROM public.byline_core_migrations ORDER BY version')).rows
    const installed = await coreRows()
    expect(installed).toHaveLength(1)
    const manifest = JSON.parse(
      readFileSync(
        new URL('../../db-postgres/migrations/0015_baseline.json', import.meta.url),
        'utf8'
      )
    )
    expect(installed[0]).toMatchObject({
      version: 15,
      origin: 'installed',
      state: 'applied',
      classification: 'fenced',
      compatible_from: 15,
      sha256: manifest.sha256,
      installation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    const names = Object.values(manifest.relations as Record<string, string[]>).flat()
    expect(createdObjects).toEqual(
      [...names, 'byline_core_migrations', 'byline_core_migrations_pkey'].sort()
    )
    const wrongOwners = await host.query(
      "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::name[]) AND pg_get_userbyid(relowner) <> $2",
      [[...names, 'byline_core_migrations', 'byline_core_migrations_pkey'], role]
    )
    expect(wrongOwners.rows).toEqual([])
    writeHostMigration(folder, timestamp, true)
    await migrate(db, { migrationsFolder: folder })
    expect(await relation(host, 'host_next')).toBe('host_next')
    expect((await hostLedger(host)).map((row) => Number(row.created_at))).toEqual([
      timestamp,
      timestamp + 1,
    ])
    expect(await coreRows()).toEqual(installed)
    const owners = await host.query(
      "SELECT relname, relowner = current_user::regrole AS owned, relacl FROM pg_class WHERE oid IN ('host_initial'::regclass,'host_next'::regclass) ORDER BY relname"
    )
    expect(owners.rows).toEqual(
      ['host_initial', 'host_next'].map((relname) => ({ relname, owned: true, relacl: null }))
    )
    const ledgerBeforeStep = await hostLedger(host)
    const steps = loadStorageSteps()
    if (!steps[0]) throw new Error('Missing fixture baseline')
    const future = {
      ...steps[0],
      version: 16,
      name: 'fixture',
      compatible_from: 16,
      sql: 'CREATE TABLE core_future_fixture (id integer)',
      relations: { r: ['core_future_fixture'] },
    }
    const connection = new Client({ connectionString: url.href })
    await connection.connect()
    try {
      expect(await installOnConnection(connection, [...steps, future])).toEqual({ applied: [16] })
    } finally {
      await connection.end()
    }
    expect(await relation(host, 'core_future_fixture')).toBe('core_future_fixture')
    expect((await coreRows()).map((row) => row.version)).toEqual([15, 16])
    expect(await hostLedger(host)).toEqual(ledgerBeforeStep)
    await resetTestDatabase(url.href)
    expect((await coreRows()).map((row) => row.version)).toEqual([15, 16])
    expect(await sentinel()).toEqual(sentinelBefore)
  })
}

describe.each(['host-first', 'byline-first'] as const)(
  'PostgreSQL journal coexistence (%s)',
  (order) => {
    it('preserves both migration histories through the PostgreSQL provisioner', () =>
      exercise(order, 'provisioner'))
    it('installs through the compiled shared-database setup command', () => exercise(order, 'cli'))
  }
)

it('serializes two installers and rolls back only the failing step', async () => {
  await withTarget(async ({ url, host }) => {
    await host.query('CREATE TABLE byline_analytics_migrations(version integer PRIMARY KEY)')
    const results = await Promise.all([installCoreStorage(url.href), installCoreStorage(url.href)])
    expect(results.flatMap((r) => r.applied)).toEqual([15])
    const steps = loadStorageSteps()
    if (!steps[0]) throw new Error('Missing fixture baseline')
    const client = new Client({ connectionString: url.href })
    try {
      await client.connect()
      await expect(
        installOnConnection(client, [
          ...steps,
          {
            ...steps[0],
            version: 16,
            sql: 'CREATE TABLE core_rollback_fixture (id integer); SELECT 1/0',
            relations: { r: ['core_rollback_fixture'] },
          },
        ])
      ).rejects.toThrow('division by zero')
    } finally {
      await client.end()
    }
    expect(await relation(host, 'core_rollback_fixture')).toBeNull()
    expect((await host.query('SELECT version FROM public.byline_core_migrations')).rows).toEqual([
      { version: 15 },
    ])
  })
})

it('retries a lost baseline commit acknowledgement without replaying SQL', async () => {
  await withTarget(async ({ url, host }) => {
    const client = new Client({ connectionString: url.href })
    try {
      await client.connect()
      // Deliver COMMIT to PostgreSQL, then discard its successful reply before
      // the executor can observe it. All other queries travel to the real server.
      client.query = new Proxy(client.query, {
        apply(target, receiver, args) {
          const result = Reflect.apply(target, receiver, args)
          if (args[0] === 'COMMIT')
            return Promise.resolve(result).then(() => {
              throw new Error('lost commit acknowledgement')
            })
          return result
        },
      })
      await expect(installOnConnection(client, loadStorageSteps())).rejects.toThrow(
        'Commit outcome unknown'
      )
    } finally {
      await client.end()
    }
    const before = (await host.query('SELECT * FROM public.byline_core_migrations')).rows
    expect(before).toHaveLength(1)
    expect(await installCoreStorage(url.href)).toEqual({ applied: [] })
    expect((await host.query('SELECT * FROM public.byline_core_migrations')).rows).toEqual(before)
  })
})

it.each([
  ['CREATE INDEX idx_audit_log_action ON host_sentinel(id)', 'public.idx_audit_log_action'],
  ["CREATE TYPE byline_documents AS ENUM ('host')", 'type public.byline_documents'],
  ['CREATE TABLE byline_documents (id text)', 'public.byline_documents'],
  ['CREATE VIEW byline_core_migrations AS SELECT 1 AS version', 'Incompatible journal definition'],
])('refuses a core name collision before mutation: %s', async (sql, message) => {
  await withTarget(async ({ url, host }) => {
    await host.query(sql)
    await expect(installCoreStorage(url.href)).rejects.toThrow(message)
    expect(await relation(host, 'byline_document_versions')).toBeNull()
    expect((await host.query('SELECT * FROM host_sentinel')).rows).toEqual([{ id: 42 }])
  })
})

it('preserves driver options and refuses an unsupported target schema', async () => {
  await withTarget(async ({ url, host }) => {
    await host.query('CREATE SCHEMA host_schema')
    url.searchParams.set('options', '-c search_path=public,host_schema')
    await expect(installCoreStorage(url.href)).rejects.toThrow('search_path')
    expect(await relation(host, 'byline_core_migrations')).toBeNull()
  })
})

it('installs through real dedicated setup, refuses occupied retries and supports confirmed reset', async () => {
  await withTarget(async ({ url, role, cwd, database }) => {
    const admin = new Client({ connectionString: process.env.BYLINE_CLI_POSTGRES_ADMIN_URL })
    const dedicated = database.replace('_coexist_', '_dedicated_')
    url.pathname = `/${dedicated}`
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${dedicated}`)
      try {
        console.info('dedicated target:', dedicated)
        prepareHost(cwd, url.href)
        writeFileSync(
          join(cwd, '.byline-install.json'),
          JSON.stringify({
            version: 1,
            startedAt: new Date().toISOString(),
            completedPhases: ['db'],
            wireSubEdits: {},
            answers: {
              dbAdapter: 'postgres',
              dbName: dedicated,
              dbUser: role,
              dbHost: url.hostname,
              dbPort: Number(url.port),
            },
          })
        )
        const env = {
          BYLINE_CLI_POSTGRES_ADMIN_URL: process.env.BYLINE_CLI_POSTGRES_ADMIN_URL,
          BYLINE_DB_PASSWORD: url.password,
        }
        runSetup(cwd, url.href, [], env)
        const inspect = async () => {
          const client = new Client({ connectionString: url.href })
          try {
            await client.connect()
            return (
              await client.query(
                'SELECT version,installation_id FROM public.byline_core_migrations'
              )
            ).rows
          } finally {
            await client.end()
          }
        }
        const first = await inspect()
        expect(first).toMatchObject([{ version: 15 }])
        runSetup(cwd, url.href, ['--force'], env, 1)
        expect(await inspect()).toEqual(first)
        runSetup(cwd, url.href, ['--force', '--reset', '--i-mean-it'], env)
        const reset = await inspect()
        expect(reset).toMatchObject([{ version: 15 }])
        expect(reset[0].installation_id).not.toBe(first[0].installation_id)
      } finally {
        await admin.query(`DROP DATABASE ${dedicated}`)
      }
    } finally {
      await admin.end()
    }
  })
})

it('resumes a failed seed on the verified shared installation', async () => {
  await withTarget(async ({ cwd, url, host }) => {
    prepareHost(cwd, url.href)
    runSetup(cwd, url.href, ['--existing-database'], {}, 1, true)
    const before = (await host.query('SELECT * FROM public.byline_core_migrations')).rows
    expect(before).toHaveLength(1)
    mkdirSync(join(cwd, 'byline/seeds'), { recursive: true })
    writeFileSync(join(cwd, 'byline/seeds/admin.ts'), '')
    writeFileSync(
      join(cwd, 'byline/seed-admin.ts'),
      "import {writeFileSync} from 'node:fs'; writeFileSync('seed-ran','yes')"
    )
    const tsx = fileURLToPath(new URL('../../db-postgres/node_modules/tsx/', import.meta.url))
    mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true })
    symlinkSync(tsx, join(cwd, 'node_modules/tsx'), 'dir')
    symlinkSync(join(tsx, 'dist/cli.mjs'), join(cwd, 'node_modules/.bin/tsx'))
    runSetup(
      cwd,
      url.href,
      [],
      { npm_config_offline: 'true', npm_config_cache: join(cwd, '.npm-cache') },
      0,
      true
    )
    expect(readFileSync(join(cwd, 'seed-ran'), 'utf8')).toBe('yes')
    expect((await host.query('SELECT * FROM public.byline_core_migrations')).rows).toEqual(before)
  })
})
