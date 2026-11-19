import { randomBytes } from 'node:crypto'

import { initBylineCore } from '@byline/core'
import { mysqlAdapter } from '@byline/db-mysql'
import { adoptCoreStorage, installCoreStorage } from '@byline/db-mysql/migrations'
import { createConnection, createPool, escapeId } from 'mysql2/promise'
import { expect, it } from 'vitest'

import { loadBaseline, prefix } from '../../db-mysql/dist/migrations/assets.js'
import { rows } from '../../db-mysql/dist/migrations/catalog.js'
import { inspectOnConnection } from '../../db-mysql/dist/migrations/inspect.js'
import { migrateOnConnection } from '../../db-mysql/dist/migrations/operations.js'
import { assertRuntimeStorage } from '../../db-mysql/dist/migrations/runtime.js'
import { fencedBackfill, onlineColumns } from './mysql-steps.js'
import { withMysqlTarget } from './mysql-target.js'

const base = loadBaseline()
const online = onlineColumns(base, '0.0.0-fixture', ['8.0.16', '8.0.46', '8.4.13', '9.7.1']),
  fenced = fencedBackfill(base)
it('adopted schema advances safely, blocks readiness at final unrecorded DDL, and resumes under supervision', async () =>
  withMysqlTarget(async (url, _admin, database) => {
    await installCoreStorage(url.href)
    const direct = await createConnection(url.href),
      control = await createConnection(url.href),
      runtime = await createConnection(url.href)
    const pool = createPool({ uri: url.href, connectionLimit: 1 })
    try {
      await direct.query('DROP TABLE byline_core_migrations')
      await direct.query(
        'ALTER TABLE byline_documents MODIFY revision BIGINT NOT NULL AFTER updated_at'
      )
      expect(await adoptCoreStorage(url.href)).toMatchObject({ adopted: true })
      await direct.query(
        "INSERT INTO byline_collections(id,path,singular,plural,config) VALUES('c','fixture','A','As','{}')"
      )
      await direct.query(
        "INSERT INTO byline_documents(id,collection_id,source_locale,revision) VALUES('d','c','en',1)"
      )
      const opts = { runtime, control, deployedReleases: ['0.0.0-fixture'] }
      await expect(assertRuntimeStorage(pool, [base, online])).rejects.toThrow(/pending/)
      const [server] = await rows(direct, 'SELECT VERSION() AS version')
      if (!online.online!.server_versions.includes(String(server!.version).split('-')[0]!)) {
        await expect(migrateOnConnection(direct, [base, online], opts)).rejects.toThrow(
          /blocked at 11/
        )
        expect(await rows(direct, 'SELECT version FROM byline_core_migrations')).toMatchObject([
          { version: 10 },
        ])
        expect(await migrateOnConnection(direct, [base, online])).toEqual({ applied: [11] })
        return
      }
      await expect(migrateOnConnection(direct, [base, online, fenced], opts)).rejects.toThrow(
        /blocked at 12/
      )
      await expect(
        migrateOnConnection(direct, [base, online], { ...opts, deployedReleases: ['0.0.1'] })
      ).rejects.toThrow(/blocked at 11/)
      expect(await rows(direct, 'SELECT version FROM byline_core_migrations')).toMatchObject([
        { version: 10 },
      ])
      await expect(
        migrateOnConnection(direct, [base, online], {
          ...opts,
          afterDdl: (_v, s) => {
            if (s === 2) throw Error('lost final DDL receipt')
          },
        })
      ).rejects.toThrow('lost final DDL receipt')
      expect(
        await rows(direct, 'SELECT state,stage FROM byline_core_migrations WHERE version=11')
      ).toMatchObject([{ state: 'applying', stage: 1 }])
      expect(
        (await inspectOnConnection(direct, database, base, false, [base, online])).findings[0]
          ?.observed
      ).toContain('next DDL is already present')
      await expect(assertRuntimeStorage(pool, [base])).rejects.toThrow(/applying/)
      await expect(migrateOnConnection(direct, [base, online], opts)).rejects.toThrow(
        /supervised recovery/
      )
      expect(await migrateOnConnection(direct, [base, online])).toEqual({ applied: [11] })
      await assertRuntimeStorage(pool, [base])
      await assertRuntimeStorage(pool, [base, online])
      await direct.query('CREATE TABLE test_backfill_guard (ready INT)')
      const guarded = {
        ...fenced,
        stages: [
          {
            ...fenced.stages[0]!,
            data: {
              before: 'SELECT 1',
              after:
                'SELECT EXISTS(SELECT 1 FROM test_backfill_guard WHERE ready=1) AND NOT EXISTS(SELECT 1 FROM byline_documents WHERE fixture_a IS NULL)',
            },
          },
        ],
      }
      await expect(migrateOnConnection(direct, [base, online, guarded])).rejects.toThrow(
        'Data postcondition'
      )
      expect(await rows(direct, 'SELECT fixture_a FROM byline_documents')).toMatchObject([
        { fixture_a: null },
      ])
      expect(
        await rows(direct, 'SELECT stage,state FROM byline_core_migrations WHERE version=12')
      ).toMatchObject([{ stage: 0, state: 'applying' }])
      await direct.query('INSERT INTO test_backfill_guard VALUES(1)')
      expect(await migrateOnConnection(direct, [base, online, guarded])).toEqual({ applied: [12] })
      expect(await rows(direct, 'SELECT fixture_a FROM byline_documents')).toMatchObject([
        { fixture_a: 1 },
      ])
      await expect(assertRuntimeStorage(pool, [base])).rejects.toThrow(/Newer/)
      await direct.query("UPDATE byline_core_migrations SET digest=REPEAT('0',64) WHERE version=11")
      await expect(assertRuntimeStorage(pool, [base, online, fenced])).rejects.toThrow(/Corrupt/)
    } finally {
      await direct.end()
      await control.end()
      await runtime.end()
      await pool.end()
    }
  }))

it('boots core and scheduler with runtime privileges on content and SELECT-only on history', async () =>
  withMysqlTarget(async (url, admin, database) => {
    await installCoreStorage(url.href)
    const account = `byline_runtime_${randomBytes(5).toString('hex')}`,
      password = randomBytes(12).toString('hex')
    const role = `byline_grants_${randomBytes(5).toString('hex')}`
    const target = new URL(url)
    target.username = account
    target.password = password
    await admin.query(`CREATE USER '${account}'@'%' IDENTIFIED BY ?`, [password])
    const db = mysqlAdapter({
      connectionString: target.href,
      collections: [],
      defaultContentLocale: 'en',
    })
    const grant = async (priv: string, table: string) =>
      admin.query(`GRANT ${priv} ON ${escapeId(database)}.${escapeId(table)} TO '${role}'@'%'`)
    try {
      await admin.query(`CREATE ROLE '${role}'@'%'`)
      await admin.query(`GRANT '${role}'@'%' TO '${account}'@'%'`)
      await admin.query(`SET DEFAULT ROLE '${role}'@'%' TO '${account}'@'%'`)
      for (const [name, lines] of prefix(base.stages, Infinity))
        await grant(
          lines.some((l) => l.startsWith('CREATE TABLE '))
            ? 'SELECT,INSERT,UPDATE,DELETE'
            : 'SELECT',
          name
        )
      await grant('SELECT', 'byline_core_migrations')
      const ready = await initBylineCore({
        collections: [],
        db,
        i18n: {
          admin: { locales: [], defaultLocale: 'en' },
          content: { locales: ['en'], defaultLocale: 'en' },
        },
        scheduledPublication: { enabled: true },
      })
      expect(ready.recurringTasks.some((t) => t.name === 'documents.publish-scheduled')).toBe(true)
      await db.pool.query(
        "INSERT INTO byline_collections(id,path,singular,plural,config) VALUES('c','fixture','A','As','{}')"
      )
      await db.pool.query(
        "INSERT INTO byline_documents(id,collection_id,source_locale,revision) VALUES('d','c','en',1)"
      )
      await db.pool.query("UPDATE byline_documents SET revision=2 WHERE id='d'")
      expect((await db.pool.query('SELECT revision FROM byline_documents'))[0]).toMatchObject([
        { revision: 2 },
      ])
      await expect(db.pool.query('DELETE FROM byline_core_migrations')).rejects.toThrow(/denied/i)
      await grant('UPDATE (state)', 'byline_core_migrations')
      await expect(assertRuntimeStorage(db.pool)).rejects.toThrow(/Split-role/)
      await admin.query(
        `REVOKE UPDATE (state) ON ${escapeId(database)}.byline_core_migrations FROM '${role}'@'%'`
      )
      await admin.query(
        `REVOKE DELETE ON ${escapeId(database)}.byline_documents FROM '${role}'@'%'`
      )
      await expect(assertRuntimeStorage(db.pool)).rejects.toThrow(/DELETE on byline_documents/)
    } finally {
      await db.pool.end()
      await admin.query(`DROP USER IF EXISTS '${account}'@'%'`)
      await admin.query(`DROP ROLE IF EXISTS '${role}'@'%'`)
    }
  }))

it('enforces the requested DDL algorithm and cancels an over-budget statement without marking it complete', async () =>
  withMysqlTarget(async (url) => {
    await installCoreStorage(url.href)
    const direct = await createConnection(url.href),
      runtime = await createConnection(url.href),
      control = await createConnection(url.href),
      blocker = await createConnection(url.href)
    try {
      const opts = { runtime, control, deployedReleases: ['0.0.0-fixture'] }
      const [server] = await rows(direct, 'SELECT VERSION() AS version')
      // This isolated algorithm/timeout fixture exercises the current server directly.
      const onServer = onlineColumns(base, '0.0.0-fixture', [
        String(server!.version).split('-')[0]!,
      ])
      // InnoDB cannot change this column's type using INSTANT. MySQL must
      // refuse, rather than silently rebuilding under a different algorithm.
      const sql =
        'ALTER TABLE `byline_documents` MODIFY COLUMN `revision` DECIMAL(20) NOT NULL, ALGORITHM=INSTANT, LOCK=DEFAULT'
      const denied = {
        ...onServer,
        statements: [sql],
        stages: [
          {
            object: 'byline_documents',
            remove: ['column 5 `revision` bigint NOT NULL'],
            add: ['column 5 `revision` decimal(20,0) NOT NULL'],
          },
        ],
      }
      await expect(migrateOnConnection(direct, [base, denied], opts)).rejects.toThrow(
        /ALGORITHM=INSTANT|cannot change|check constraint/i
      )
      expect(
        await rows(direct, 'SELECT stage,state FROM byline_core_migrations WHERE version=11')
      ).toMatchObject([{ stage: 0, state: 'applying' }])
      // Restore the known baseline in this disposable fixture for an independent
      // timeout test; both definition and stage are still the verified before-state.
      await direct.query('DELETE FROM byline_core_migrations WHERE version=11')
      const timed = {
        ...onServer,
        online: { ...onServer.online!, lock_timeout_ms: 2000, statement_timeout_ms: 150 },
      }
      await blocker.beginTransaction()
      await blocker.query('SELECT id FROM byline_documents LIMIT 1')
      const start = performance.now()
      await expect(migrateOnConnection(direct, [base, timed], opts)).rejects.toThrow(
        /statement budget exceeded/
      )
      expect(performance.now() - start).toBeLessThan(1900)
      await blocker.rollback()
      expect(await migrateOnConnection(direct, [base, timed])).toEqual({ applied: [11] })
    } finally {
      await blocker.end()
      await direct.end()
      await runtime.end()
      await control.end()
    }
  }))

it('allows a legacy unjournaled baseline only while the application still targets 0010', async () =>
  withMysqlTarget(async (url) => {
    await installCoreStorage(url.href)
    const pool = createPool({ uri: url.href, connectionLimit: 1 })
    try {
      await pool.query('DROP TABLE byline_core_migrations')
      await assertRuntimeStorage(pool, [base])
      await expect(assertRuntimeStorage(pool, [base, online])).rejects.toThrow(
        /requires a readable, valid/
      )
    } finally {
      await pool.end()
    }
  }))

it('refuses a paired runtime endpoint still observing the previous version of the same installation', async () =>
  withMysqlTarget(async (url) => {
    await installCoreStorage(url.href)
    const direct = await createConnection(url.href),
      runtime = await createConnection(url.href),
      control = await createConnection(url.href)
    try {
      await runtime.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await runtime.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
      expect(await rows(runtime, 'SELECT version FROM byline_core_migrations')).toMatchObject([
        { version: 10 },
      ])
      expect(await migrateOnConnection(direct, [base, online])).toEqual({ applied: [11] })
      await expect(
        migrateOnConnection(direct, [base, online], { runtime, control })
      ).rejects.toThrow(/different MySQL installations/)
      await runtime.rollback()
      expect(await migrateOnConnection(direct, [base, online], { runtime, control })).toEqual({
        applied: [],
      })
    } finally {
      await runtime.end()
      await control.end()
      await direct.end()
    }
  }))
