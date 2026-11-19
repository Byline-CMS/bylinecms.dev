import { execFileSync, fork, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConnection } from 'mysql2/promise'
import { expect, it } from 'vitest'

import { dependencySpecsFor } from '../../src/manifest/deps.js'
import { ENV_FILE_PATHS, envSpecsForAdapter } from '../../src/manifest/env.js'
import { fencedBackfill, onlineColumns } from '../mysql-steps.js'
import { withMysqlTarget } from '../mysql-target.js'
import { withTarget } from '../postgres-target.js'
import { call, reply } from './consumer-ipc.js'
import type { MysqlStep } from '../../../db-mysql/dist/migrations/assets.js'

type Dialect = 'postgres' | 'mysql'
const root = process.env.BYLINE_TEST_PACKED_ROOT!
const pkg = (name: string) => join(root, 'node_modules', '@byline', name)
const executable = join(pkg('cli'), 'dist/cli.js')
const release = JSON.parse(readFileSync(join(pkg('cli'), 'package.json'), 'utf8')).version as string
const envKey = (d: Dialect) => `BYLINE_DB_${d.toUpperCase()}_CONNECTION_STRING`

function command(cwd: string, d: Dialect, url: URL, args: string[], expected = 0, direct = url) {
  const result = spawnSync(process.execPath, [executable, ...args, '--database', d], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      BYLINE_DB_PASSWORD: decodeURIComponent(url.password),
      [envKey(d)]: url.href,
      BYLINE_MIGRATION_DATABASE_URL: direct.href,
    },
  })
  if (result.error) throw result.error
  const output = (result.stdout + result.stderr)
    .replaceAll(url.href, '[database]')
    .replaceAll(direct.href, '[direct]')
  expect(result.status, output).toBe(expected)
  return output
}

function setup(cwd: string, d: Dialect, url: URL, expected = 0) {
  const dependencies = Object.fromEntries(
    dependencySpecsFor({ dbAdapter: d })
      .filter((x) => x.group === 'byline')
      .map((x) => [x.name, x.version])
  )
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'release-host', dependencies }))
  mkdirSync(join(cwd, '.git'), { recursive: true })
  for (const file of ['public', 'secret'] as const)
    writeFileSync(
      join(cwd, ENV_FILE_PATHS[file]),
      envSpecsForAdapter(d)
        .filter((x) => x.file === file)
        .map((x) => `${x.key}=${x.key === envKey(d) ? url.href : 'fixture'}`)
        .join('\n'),
      { mode: 0o600 }
    )
  writeFileSync(
    join(cwd, '.byline-install.json'),
    JSON.stringify({
      version: 1,
      startedAt: new Date().toISOString(),
      completedPhases: ['db'],
      answers: {
        dbAdapter: d,
        dbName: url.pathname.slice(1),
        dbUser: url.username,
        dbHost: url.hostname,
        dbPort: Number(url.port || (d === 'postgres' ? 5432 : 3306)),
      },
      wireSubEdits: {},
    })
  )
  return command(
    cwd,
    d,
    url,
    [
      'setup',
      '--apply',
      '--yes',
      '--pm',
      'npm',
      '--no-seed-admin',
      '--no-seed-docs',
      ...(d === 'postgres' ? ['--existing-database'] : []),
    ],
    expected
  )
}

// Assemble two hypothetical release archives from the installed release-form
// adapter. Extract each complete archive into this disposable consumer.
function releaseFixtures(d: Dialect, cwd: string, server: string) {
  const installed = realpathSync(pkg(`db-${d}`)),
    folder = join(cwd, 'package')
  cpSync(installed, folder, { recursive: true })
  const dir = join(folder, 'migrations')
  const save = (version: number, name: string, sql: string, fields: object) => {
    const stem = join(dir, `${String(version).padStart(4, '0')}_${name}`)
    writeFileSync(`${stem}.sql`, sql)
    writeFileSync(
      `${stem}.json`,
      JSON.stringify({
        ...fields,
        name,
        version,
        sha256: createHash('sha256').update(sql).digest('hex'),
      })
    )
  }
  const archive = (suffix: string) => {
    const path = join(cwd, `${suffix}.tgz`)
    execFileSync('tar', ['-czf', path, '-C', cwd, 'package'])
    return path
  }
  const mysqlBase =
    d === 'mysql'
      ? (JSON.parse(readFileSync(join(dir, '0010_baseline.json'), 'utf8')) as MysqlStep)
      : undefined
  if (mysqlBase) {
    const step = onlineColumns(mysqlBase, release, [server])
    save(step.version, step.name, step.statements.join('--> statement-breakpoint'), step)
  } else
    save(
      16,
      'compatibility_fixture',
      'ALTER TABLE public.byline_documents ADD COLUMN compatibility_fixture_16 text',
      {
        classification: 'online',
        compatible_from: 15,
        relations: {},
        online: {
          tested_releases: { [release]: 15 },
          evidence: 'Disposable released-writer workload',
          lock_timeout_ms: 1000,
          statement_timeout_ms: 5000,
        },
      }
    )
  const online = archive('online')
  if (mysqlBase) {
    const step = fencedBackfill(mysqlBase)
    save(step.version, step.name, step.statements[0]!, step)
  } else
    save(
      17,
      'fenced_fixture',
      'ALTER TABLE public.byline_documents ADD COLUMN fenced_fixture text',
      { classification: 'fenced', compatible_from: 17, relations: {} }
    )
  const mixed = archive('mixed')
  const activate = (path: string) => {
    rmSync(installed, { recursive: true })
    mkdirSync(installed)
    execFileSync('tar', ['-xzf', path, '--strip-components=1', '-C', installed])
  }
  return { online, mixed, activate }
}

function installPacked(d: Dialect, url: URL) {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {installCoreStorage} from '@byline/db-${d}/migrations';await installCoreStorage(process.env.${envKey(d)})`,
    ],
    { cwd: root, env: { ...process.env, [envKey(d)]: url.href } }
  )
}

async function exercise(
  d: Dialect,
  cwd: string,
  owner: URL,
  runtime: URL,
  server: string,
  query: (sql: string) => Promise<unknown[]>
) {
  const history = () =>
    query('SELECT version,origin,state FROM byline_core_migrations ORDER BY version')
  const host = () => query('SELECT * FROM host_sentinel ORDER BY id')
  const sentinel = await host()
  const base = d === 'mysql' ? 10 : 15
  expect(await history()).toEqual([{ version: base, origin: 'installed', state: 'applied' }])
  await query('DROP TABLE byline_core_migrations')
  expect(command(root, d, owner, ['storage', 'status'], 3)).toContain('recognized')
  expect(command(root, d, owner, ['storage', 'adopt', '--yes'])).toContain('adopted')
  expect(await history()).toEqual([{ version: base, origin: 'adopted', state: 'applied' }])
  const skew = join(cwd, 'old-host')
  const metadata = join(skew, 'node_modules/@byline', `db-${d}`)
  mkdirSync(metadata, { recursive: true })
  writeFileSync(
    join(skew, 'package.json'),
    JSON.stringify({ dependencies: { [`@byline/db-${d}`]: '1.0.0' } })
  )
  writeFileSync(
    join(metadata, 'package.json'),
    JSON.stringify({ name: `@byline/db-${d}`, version: '1.0.0' })
  )
  expect(command(skew, d, owner, ['storage', 'migrate', '--yes'], 1)).toMatch(/version mismatch/i)
  const current = await history()
  for (const provider of ['search', 'analytics']) {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import {createRequire} from 'node:module'
      import {migrate} from '@byline/${provider}-${d}'
      const require=createRequire(import.meta.resolve('@byline/db-${d}'))
      const url=process.env.${envKey(d)}
      const pool=${d === 'mysql' ? "require('mysql2/promise').createPool(url)" : "new (require('pg').Pool)({connectionString:url})"}
      try {await migrate(pool)} finally {await pool.end()}`,
      ],
      { cwd: root, env: { ...process.env, [envKey(d)]: owner.href } }
    )
    expect(
      (await query(`SELECT version FROM byline_${provider}_migrations`)).length
    ).toBeGreaterThan(0)
    expect(await history()).toEqual(current)
  }
  const providers = async () => [
    await query('SELECT * FROM byline_search_migrations ORDER BY version'),
    await query('SELECT * FROM byline_analytics_migrations ORDER BY version'),
  ]
  const independent = await providers()
  const f = releaseFixtures(d, cwd, server)
  const args = ['storage', 'migrate', '--online-only', '--deployed-adapter-version', release]
  f.activate(f.mixed)
  expect(command(root, d, owner, ['storage', 'status'], 2)).toContain('pending')
  expect(command(root, d, runtime, args, 1, owner)).toMatch(/blocked/i)
  expect(await history()).toEqual(current)
  f.activate(f.online)
  expect(command(root, d, runtime, args, 0, owner)).toContain('Applied online migrations')
  expect(command(root, d, owner, ['storage', 'status'])).toContain('current')
  const actor = fork(
    fileURLToPath(new URL('./storage-consumer.mjs', import.meta.url)),
    [root, 'packed', d],
    { execArgv: [], env: { ...process.env, [envKey(d)]: runtime.href } }
  )
  try {
    expect(await reply(actor)).toBe('ready')
    const id = await call(actor, 'cycle', 'packed article')
    await call(actor, 'read', 'packed article', id)
    await call(actor, 'worker')
  } finally {
    if (actor.connected) {
      const closed = once(actor, 'exit')
      actor.send({ action: 'stop' })
      await closed
    }
  }
  f.activate(f.mixed)
  expect(command(root, d, owner, ['storage', 'migrate', '--yes'])).toContain(
    'Applied core migrations'
  )
  expect((await history()).map((row) => (row as { version: number }).version)).toEqual([
    base,
    base + 1,
    base + 2,
  ])
  expect(await providers()).toEqual(independent)
  expect(await host()).toEqual(sentinel)
}

it(
  'installs the packed PostgreSQL CLI before host dependencies, preserves host ownership and exercises both release modes',
  async () =>
    withTarget(async ({ cwd, host, url, role, database }) => {
      const admin = new URL(process.env.BYLINE_CLI_POSTGRES_ADMIN_URL!)
      admin.pathname = url.pathname
      const hostHistory = async () =>
        (
          await host.query(
            "SELECT l.*,pg_get_userbyid(c.relowner) AS owner FROM drizzle.__drizzle_migrations l,pg_class c WHERE c.oid='drizzle.__drizzle_migrations'::regclass"
          )
        ).rows
      await host.query(
        "CREATE SCHEMA drizzle;CREATE TABLE drizzle.__drizzle_migrations(id int,hash text); INSERT INTO drizzle.__drizzle_migrations VALUES(1,'host')"
      )
      const before = await hostHistory()
      const sql = join(pkg('db-postgres'), 'migrations', '0015_baseline.sql')
      renameSync(sql, `${sql}.missing`)
      try {
        expect(setup(cwd, 'postgres', admin, 1)).toMatch(/missing|inventory|ENOENT/i)
      } finally {
        renameSync(`${sql}.missing`, sql)
      }
      expect(
        (await host.query("SELECT to_regclass('byline_core_migrations') AS journal")).rows[0]
          .journal
      ).toBeNull()
      setup(cwd, 'postgres', admin)
      // This installer owns the database. Its default SELECT grant survives journal recreation.
      await host.query(
        `ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO ${role}; REVOKE CREATE ON SCHEMA public FROM ${role}; GRANT SELECT ON byline_core_migrations TO ${role}`
      )
      const { rows: coreRelations } = await host.query(
        "SELECT relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v') AND starts_with(relname,'byline_') AND relname<>'byline_core_migrations'"
      )
      for (const { relname, relkind } of coreRelations)
        await host.query(
          `GRANT ${relkind === 'v' ? 'SELECT' : 'SELECT,INSERT,UPDATE,DELETE'} ON public.${host.escapeIdentifier(relname)} TO ${role}`
        )
      await exercise('postgres', cwd, admin, url, '', async (sql) => (await host.query(sql)).rows)
      await withTarget(async (fresh) => {
        installPacked('postgres', fresh.url)
        const { rows: freshColumns } = await fresh.host.query(
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='byline_documents' ORDER BY column_name"
        )
        expect(
          (
            await host.query(
              "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='byline_documents' ORDER BY column_name"
            )
          ).rows
        ).toEqual(freshColumns)
        expect(
          (
            await fresh.host.query(
              'SELECT version,origin FROM byline_core_migrations ORDER BY version'
            )
          ).rows
        ).toEqual([
          { version: 15, origin: 'installed' },
          { version: 16, origin: 'migrated' },
          { version: 17, origin: 'migrated' },
        ])
      })
      expect(await hostHistory()).toEqual(before)
      console.info('Packed PostgreSQL release', database)
    }),
  90000
)

it(
  'installs the packed MySQL CLI and exercises both release modes and independent providers',
  async () =>
    withMysqlTarget(async (url, admin, database) => {
      const cwd = mkdtempSync(join(tmpdir(), 'packed-mysql-host-'))
      const user = `packed_${randomBytes(5).toString('hex')}`,
        runtime = new URL(url),
        owner = new URL(url)
      owner.username = user
      owner.password = randomBytes(12).toString('hex')
      const reader = `${user}_app`
      runtime.username = reader
      runtime.password = randomBytes(12).toString('hex')
      const direct = await createConnection(url.href)
      const query = async (sql: string) => (await direct.query(sql))[0] as unknown[]
      try {
        const raw = join(pkg('db-mysql'), 'migrations', '0010_baseline.sql')
        const saved = join(cwd, 'released.sql')
        renameSync(raw, saved)
        try {
          writeFileSync(raw, '-- corrupted release fixture')
          expect(setup(cwd, 'mysql', owner, 1)).toMatch(/digest|checksum/i)
          expect(await query('SHOW TABLES')).toEqual([])
          expect(
            (await admin.query('SELECT User FROM mysql.user WHERE User=?', [user]))[0]
          ).toEqual([])
        } finally {
          rmSync(raw, { force: true })
          renameSync(saved, raw)
        }
        setup(cwd, 'mysql', owner)
        await direct.query('CREATE TABLE host_sentinel(id int PRIMARY KEY)')
        await direct.query('INSERT INTO host_sentinel VALUES(42)')
        await admin.query(`CREATE USER '${reader}'@'%' IDENTIFIED BY ?`, [runtime.password])
        const tables = await query(
          'SELECT TABLE_NAME AS name,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'
        )
        for (const { name, kind } of tables as { name: string; kind: string }[]) {
          const grants =
            kind === 'BASE TABLE' && name !== 'byline_core_migrations'
              ? 'SELECT,INSERT,UPDATE,DELETE'
              : 'SELECT'
          await admin.query(`GRANT ${grants} ON \`${database}\`.\`${name}\` TO '${reader}'@'%'`)
        }
        const [v] = (await query('SELECT VERSION() AS v')) as { v: string }[]
        await exercise('mysql', cwd, owner, runtime, v!.v.split('-')[0]!, query)
        await withMysqlTarget(async (fresh) => {
          installPacked('mysql', fresh)
          const sibling = await createConnection(fresh.href)
          try {
            const columns =
              "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='byline_documents' ORDER BY COLUMN_NAME"
            expect((await sibling.query(columns))[0]).toEqual(await query(columns))
            expect(
              (
                await sibling.query(
                  'SELECT version,origin FROM byline_core_migrations ORDER BY version'
                )
              )[0]
            ).toEqual([
              { version: 10, origin: 'installed' },
              { version: 11, origin: 'migrated' },
              { version: 12, origin: 'migrated' },
            ])
          } finally {
            await sibling.end()
          }
        })
      } finally {
        await direct.end()
        await admin.query(`DROP USER IF EXISTS '${reader}'@'%','${user}'@'%'`)
        rmSync(cwd, { recursive: true, force: true })
      }
    }),
  90000
)

it(
  'rehearses the packaged raw PostgreSQL transaction, collision refusal and explicit adoption',
  async () =>
    withTarget(async ({ host, url, cwd, database }) => {
      const renderer = join(pkg('db-postgres'), 'scripts/render-baseline.mjs')
      const script = execFileSync(process.execPath, [renderer], { encoding: 'utf8' })
      const psql = (target: string) =>
        spawnSync('psql', ['-X', '--quiet', '--set', `byline_target=${target}`, '--file', '-'], {
          input: script,
          encoding: 'utf8',
          env: {
            ...process.env,
            PGHOST: url.hostname,
            PGPORT: url.port || '5432',
            PGDATABASE: database,
            PGUSER: url.username,
            PGPASSWORD: url.password,
          },
        })
      expect(psql(`${database}_other`).status).toBe(3)
      await host.query("CREATE TYPE public._byline_documents AS ENUM ('host')")
      const conflict = psql(database)
      expect(conflict.status, conflict.stderr).toBe(3)
      expect(conflict.stderr).toContain('occupied')
      expect(
        (await host.query("SELECT to_regclass('public.byline_collections') AS name")).rows[0].name
      ).toBeNull()
      await host.query('DROP TYPE public._byline_documents')
      const installed = psql(database)
      expect(installed.status, installed.stderr).toBe(0)
      expect(command(cwd, 'postgres', url, ['storage', 'status'], 3)).toContain('recognized')
      expect(command(cwd, 'postgres', url, ['storage', 'adopt', '--yes'])).toContain('adopted')
      expect((await host.query('SELECT version,origin FROM byline_core_migrations')).rows).toEqual([
        { version: 15, origin: 'adopted' },
      ])
      expect((await host.query('SELECT * FROM host_sentinel')).rows).toEqual([{ id: 42 }])
    }),
  90000
)
