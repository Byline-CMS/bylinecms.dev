import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  adoptCoreStorage,
  inspectCoreStorage,
  installCoreStorage,
} from '@byline/db-mysql/migrations'
import { createConnection } from 'mysql2/promise'
import { expect, it } from 'vitest'

import { createJournal, rows } from '../../db-mysql/dist/migrations/catalog.js'
import { withMysqlTarget } from './mysql-target.js'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const native = new URL('../../db-mysql/sql/', import.meta.url)
const baseline = new URL('./fixtures/mysql/v4.10.2.sql', import.meta.url)

it('adopts populated native 0001–0010, diagnoses missing migration effects, and preserves independent data', async () =>
  withMysqlTarget(async (url, admin, name) => {
    const connection = await createConnection({ uri: url.href, multipleStatements: true })
    const workspace = mkdtempSync(join(tmpdir(), 'byline-adoption-'))
    const account = `byline_read_${randomBytes(5).toString('hex')}`
    const pass = randomBytes(12).toString('hex')
    const command = (...args: string[]) =>
      spawnSync(process.execPath, [cli, 'storage', ...args, '--database', 'mysql'], {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...process.env, BYLINE_DB_MYSQL_CONNECTION_STRING: url.href },
      })
    try {
      expect((await inspectCoreStorage(url.href)).state).toBe('empty')
      await connection.query(
        'CREATE TABLE host_sentinel(id INT PRIMARY KEY); INSERT INTO host_sentinel VALUES(42)'
      )
      expect((await inspectCoreStorage(url.href)).state).toBe('unrelated')
      await connection.query(
        readFileSync(baseline, 'utf8').replaceAll('--> statement-breakpoint', '')
      )
      await connection.query(`INSERT INTO byline_collections(id,path,singular,plural,config) VALUES ('c','articles','Article','Articles','{}');
      INSERT INTO byline_documents(id,collection_id,order_key,source_locale) VALUES ('d','c','a0','en');
      INSERT INTO byline_document_versions(id,document_id,collection_id,collection_version,status) VALUES ('v1','d','c',1,'published');
      INSERT INTO byline_document_paths(document_id,locale,collection_id,path) VALUES ('d','en','c','/example');
      INSERT INTO byline_store_text(id,document_version_id,collection_id,field_path,field_name,locale,value) VALUES
        ('t1','v1','c','title','title','en','Original');
      INSERT INTO byline_document_version_locales VALUES ('v1','en');
      CREATE TABLE __drizzle_migrations (id INT PRIMARY KEY); INSERT INTO __drizzle_migrations VALUES(987)`)
      expect((await inspectCoreStorage(url.href)).state).toBe('partial')
      const [{ v: serverVersion }] = (await rows(connection, 'SELECT VERSION() AS v')) as [
        { v: string },
      ]
      for (const file of readdirSync(native)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        const sql = readFileSync(new URL(file, native), 'utf8').replaceAll(
          '--> statement-breakpoint',
          ''
        )
        if (serverVersion === '8.0.16' && file.startsWith('0005_')) {
          // The immutable historical guard expected IS NULL, while this patch
          // prints ISNULL. Preserve the refusal and the operator's old content.
          await expect(connection.query(sql)).rejects.toThrow(
            /repair incompatible check_publish_schedules_suspended_reason/
          )
          expect((await inspectCoreStorage(url.href)).state).toBe('partial')
          expect(await rows(connection, "SHOW TABLES LIKE 'byline_core_migrations'")).toHaveLength(
            0
          )
          expect(await rows(connection, 'SELECT value FROM byline_store_text')).toMatchObject([
            { value: 'Original' },
          ])
          return
        }
        await connection.query(sql)
      }
      // The historic English anchor requires both English fields for complete
      // coverage. French only had title. A later re-anchor must not retroactively
      // require a French ledger entry for the incomplete old translation.
      await connection.query(`INSERT INTO byline_store_text(id,document_version_id,collection_id,field_path,field_name,locale,value) VALUES
        ('t2','v1','c','body','body','en','Body'),('t3','v1','c','title','title','fr','Titre');
        UPDATE byline_documents SET source_locale='fr';
        INSERT INTO byline_document_versions(id,document_id,collection_id,collection_version,event_type,change_summary)
        VALUES ('v2','d','c',1,'update','re-anchored content source locale en → fr');
        INSERT INTO byline_document_version_locales VALUES ('v2','all');
        INSERT INTO byline_document_publish_schedules
        (document_id,collection_id,target_version_id,publish_at,last_authorized_at,next_attempt_at,state,suspended_reason)
        VALUES ('d','c','v1',NOW(6),NOW(6),NOW(6),'needs_reconfirm','upgrade_invalidated')`)
      const recognized = await inspectCoreStorage(url.href)
      expect(recognized, JSON.stringify(recognized)).toMatchObject({
        state: 'recognized',
        observed: 10,
      })
      await connection.query(
        "UPDATE byline_document_paths SET deleted_at=NOW(6); DELETE FROM byline_document_version_locales; UPDATE byline_document_publish_schedules SET state='armed',suspended_reason=NULL"
      )
      const failed = await inspectCoreStorage(url.href)
      expect(failed.findings.map((f) => f.check)).toEqual(
        expect.arrayContaining([
          'path-liveness',
          'version-locale-coverage',
          'schedule-authorization',
        ])
      )
      await expect(adoptCoreStorage(url.href)).rejects.toThrow(/Cannot adopt: partial/)
      expect(await rows(connection, "SHOW TABLES LIKE 'byline_core_migrations'")).toHaveLength(0)
      await connection.query(
        "UPDATE byline_document_paths SET deleted_at=NULL;INSERT INTO byline_document_version_locales VALUES ('v1','en'),('v2','all'); UPDATE byline_document_publish_schedules SET state='needs_reconfirm',suspended_reason='upgrade_invalidated'"
      )
      await connection.query(
        'ALTER TABLE byline_documents ALTER CHECK check_documents_revision NOT ENFORCED'
      )
      expect(
        (await inspectCoreStorage(url.href)).findings.some((f) => f.check === 'byline_documents')
      ).toBe(true)
      await connection.query(
        'ALTER TABLE byline_documents ALTER CHECK check_documents_revision ENFORCED'
      )
      await connection.query(
        'ALTER TABLE byline_store_file MODIFY storage_validator_kind VARCHAR(31)'
      )
      expect(
        (await inspectCoreStorage(url.href)).findings.some((f) =>
          f.observed.includes('varchar(32)')
        )
      ).toBe(true)
      await connection.query(
        'ALTER TABLE byline_store_file MODIFY storage_validator_kind VARCHAR(32)'
      )
      await admin.query(`CREATE USER '${account}'@'%' IDENTIFIED BY ?`, [pass])
      await admin.query(`GRANT SELECT ON \`${name}\`.* TO '${account}'@'%'`)
      const read = new URL(url)
      read.username = account
      read.password = pass
      const denied = await inspectCoreStorage(read.href)
      expect(denied).toMatchObject({ state: 'inaccessible' })
      expect(denied.findings[0]?.observed).toContain('SHOW VIEW')
      const preview = command('status')
      expect(preview.status, preview.stderr + preview.stdout).toBe(3)
      expect(preview.stdout).toContain('recognized')
      await connection.query(createJournal)
      expect((await inspectCoreStorage(url.href)).state).toBe('recognized')
      const adopt = command('adopt', '--yes')
      expect(adopt.status, adopt.stderr + adopt.stdout).toBe(0)
      expect(await adoptCoreStorage(url.href)).toEqual({ adopted: false, version: 10 })
      expect(await installCoreStorage(url.href)).toMatchObject({ changed: false })
      expect(
        await rows(connection, 'SELECT origin,version,state FROM byline_core_migrations')
      ).toMatchObject([{ origin: 'adopted', version: 10, state: 'applied' }])
      expect(
        await rows(connection, 'SELECT id FROM byline_current_published_documents')
      ).toMatchObject([{ id: 'v1' }])
      expect(await rows(connection, 'SELECT id FROM host_sentinel')).toMatchObject([{ id: 42 }])
      expect(await rows(connection, 'SELECT id FROM __drizzle_migrations')).toMatchObject([
        { id: 987 },
      ])
      const hostPackage = join(workspace, 'node_modules/@byline/db-mysql')
      mkdirSync(hostPackage, { recursive: true })
      writeFileSync(
        join(workspace, 'package.json'),
        JSON.stringify({ dependencies: { '@byline/db-mysql': '1.0.0' } })
      )
      writeFileSync(
        join(hostPackage, 'package.json'),
        JSON.stringify({ name: '@byline/db-mysql', version: '1.0.0' })
      )
      expect(command('status').stdout).toContain('host adapter 1.0.0')
      expect(command('adopt', '--yes').status).not.toBe(0)
    } finally {
      await connection.end()
      await admin.query(`DROP USER IF EXISTS '${account}'@'%'`)
      rmSync(workspace, { recursive: true, force: true })
    }
  }))

it('recognizes the complete checkpoint on every supported patch, and refuses wrong view semantics', async () =>
  withMysqlTarget(async (url) => {
    await installCoreStorage(url.href)
    const connection = await createConnection(url.href)
    try {
      await connection.query('DROP TABLE byline_core_migrations')
      expect((await inspectCoreStorage(url.href)).state).toBe('recognized')
      const [{ 'Create View': original }] = (await rows(
        connection,
        'SHOW CREATE VIEW byline_current_documents'
      )) as [{ 'Create View': string }]
      await connection.query(
        'ALTER VIEW byline_current_documents AS SELECT id FROM byline_documents'
      )
      expect(
        (await inspectCoreStorage(url.href)).findings.some(
          (f) => f.check === 'byline_current_documents'
        )
      ).toBe(true)
      await connection.query('DROP VIEW byline_current_documents')
      await connection.query(original)
      expect(await adoptCoreStorage(url.href)).toEqual({ adopted: true, version: 10 })
    } finally {
      await connection.end()
    }
  }))
