import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { adoptCoreStorage, inspectCoreStorage } from '@byline/db-postgres/migrations'
import { Client } from 'pg'
import { expect, it } from 'vitest'

import { loadStorageSteps } from '../../db-postgres/dist/migrations/assets.js'
import { migrateOnConnection } from '../../db-postgres/dist/migrations/operations.js'
import { withTarget } from './postgres-target.js'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
function runStorageCli(cwd: string, url: URL, args: string[], env: NodeJS.ProcessEnv = {}) {
  const run = spawnSync(process.execPath, [cli, 'storage', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, BYLINE_DB_POSTGRES_CONNECTION_STRING: url.href, ...env },
  })
  if (run.error) throw run.error
  const output = run.stdout + run.stderr
  expect(output).not.toContain(url.password)
  return { code: run.status, output }
}

it('adopts only a recognized checkpoint; a simultaneous adopter re-inspects and writes nothing', async () => {
  await withTarget(async ({ url, database, host }) => {
    await expect(adoptCoreStorage(url.href)).rejects.toThrow('unrelated')
    const db = new Client({ connectionString: url.href })
    await db.connect()
    try {
      const [base] = loadStorageSteps()
      if (!base) throw Error('Missing baseline')
      await db.query(base.sql)
      await db.query('ALTER TABLE byline_documents DROP CONSTRAINT check_documents_revision')
      await expect(adoptCoreStorage(url.href)).rejects.toThrow('check_documents_revision')
      expect(
        (await db.query("SELECT to_regclass('public.byline_core_migrations') AS journal")).rows[0]
          .journal
      ).toBeNull()
      await db.query(
        'ALTER TABLE byline_documents ADD CONSTRAINT check_documents_revision CHECK (revision BETWEEN 1 AND 9007199254740991)'
      )
      const attempts = await Promise.all([adoptCoreStorage(url.href), adoptCoreStorage(url.href)])
      expect(attempts.map((r) => r.adopted).sort()).toEqual([false, true])
      expect((await db.query('SELECT version,origin FROM byline_core_migrations')).rows).toEqual([
        { version: 15, origin: 'adopted' },
      ])
      const sql = 'CREATE TABLE public.byline_future_fixture(id integer PRIMARY KEY)'
      const step = {
        ...base,
        name: 'fixture',
        version: 16,
        compatible_from: 16,
        sql,
        sha256: createHash('sha256').update(sql).digest('hex'),
        relations: { r: ['byline_future_fixture'] },
      }
      expect(await migrateOnConnection(db, database, [base, step])).toEqual({ applied: [16] })
      expect(
        (await db.query('SELECT version,origin FROM byline_core_migrations ORDER BY version')).rows
      ).toEqual([
        { version: 15, origin: 'adopted' },
        { version: 16, origin: 'migrated' },
      ])
      expect((await inspectCoreStorage(url.href)).state).toBe('newer')
      expect((await host.query('SELECT * FROM host_sentinel')).rows).toEqual([{ id: 42 }])
    } finally {
      await db.end()
    }
  })
})

it('runs standalone and host CLI commands, reports skew and requires an exact fenced override', async () => {
  await withTarget(async ({ cwd, url, host }) => {
    const run = (...args: string[]) => runStorageCli(cwd, url, args)
    expect(run('status')).toMatchObject({ code: 4, output: expect.stringContaining('standalone') })
    expect(run('migrate')).toMatchObject({ code: 1, output: expect.stringContaining('unrelated') })
    const db = new Client({ connectionString: url.href })
    await db.connect()
    try {
      await db.query(loadStorageSteps()[0]!.sql)
    } finally {
      await db.end()
    }
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ dependencies: { '@byline/db-postgres': '1.0.0' } })
    )
    expect(run('adopt')).toMatchObject({
      code: 1,
      output: expect.stringContaining('declared host adapter'),
    })
    const path = join(cwd, 'node_modules/@byline/db-postgres')
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, 'package.json'),
      JSON.stringify({ name: '@byline/db-postgres', version: '1.0.0' })
    )
    expect(run('status')).toMatchObject({
      code: 3,
      output: expect.stringContaining('host adapter 1.0.0'),
    })
    expect(run('adopt').code).toBe(1)
    expect(run('adopt', '--target-adapter-version', '1.0.0').code).toBe(1)
    expect(run('adopt', '--target-adapter-version', version)).toMatchObject({
      code: 1,
      output: expect.stringContaining('--yes'),
    })
    expect(run('adopt', '--target-adapter-version', version, '--yes')).toMatchObject({
      code: 0,
      output: expect.stringContaining('checkpoint 15 adopted'),
    })
    writeFileSync(
      join(path, 'package.json'),
      JSON.stringify({ name: '@byline/db-postgres', version })
    )
    expect(run('adopt', '--yes')).toMatchObject({
      code: 0,
      output: expect.stringContaining('already recorded'),
    })
    expect(run('migrate', '--yes')).toMatchObject({
      code: 0,
      output: expect.stringContaining('current'),
    })
    expect(run('migrate', '--online-only')).toMatchObject({
      code: 1,
      output: expect.stringContaining('BYLINE_MIGRATION_DATABASE_URL'),
    })
    expect(
      runStorageCli(cwd, url, ['migrate', '--online-only'], {
        BYLINE_MIGRATION_DATABASE_URL: url.href,
      })
    ).toMatchObject({ code: 0, output: expect.stringContaining('current') })
    expect(
      runStorageCli(
        cwd,
        url,
        [
          'migrate',
          '--online-only',
          '--deployed-adapter-version',
          '6.13.3',
          '--deployed-adapter-version',
          version,
        ],
        { BYLINE_MIGRATION_DATABASE_URL: url.href }
      )
    ).toMatchObject({ code: 0, output: expect.stringContaining(`6.13.3, ${version}`) })
    writeFileSync(
      join(cwd, '.byline-install.json'),
      JSON.stringify({ version: 1, completedPhases: [], answers: { dbAdapter: 'mysql' } })
    )
    expect(run('migrate', '--database', 'postgres').code).toBe(1)
    expect(
      (await host.query('SELECT count(*)::int AS n FROM byline_core_migrations')).rows[0].n
    ).toBe(1)
  })
})
