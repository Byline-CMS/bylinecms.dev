import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

import {
  adoptCoreStorage,
  inspectCoreStorage,
  installCoreStorage,
} from '@byline/db-postgres/migrations'
import { Client } from 'pg'
import { expect, it } from 'vitest'

import { loadStorageSteps } from '../../db-postgres/dist/migrations/assets.js'
import { catalogFindings, readCutoverCatalog } from '../../db-postgres/dist/migrations/catalog.js'
import { readStatus } from '../../db-postgres/dist/migrations/inspect.js'
import { migrateOnConnection } from '../../db-postgres/dist/migrations/operations.js'
import { installOnConnection } from '../../db-postgres/dist/migrations/runner.js'
import { withTarget } from './postgres-target.js'

const assets = new URL('../../db-postgres/', import.meta.url)
const fixture = new URL('./fixtures/postgres/v2.7.0-baseline.sql', import.meta.url)
const baseline = readFileSync(new URL('migrations/0015_baseline.sql', assets), 'utf8')
const collection = '11111111-1111-4111-8111-111111111111'
const doc = '22222222-2222-4222-8222-222222222222'
const version = '33333333-3333-4333-8333-333333333333'

it('recognizes the tagged native upgrade and diagnoses historical evidence without writing', async () => {
  await withTarget(async ({ host, url, role, database }) => {
    await host.query(`ALTER DATABASE ${database} OWNER TO ${role}`)
    const db = new Client({ connectionString: url.href })
    await db.connect()
    try {
      await db.query(readFileSync(fixture, 'utf8'))
      await db.query(
        "INSERT INTO byline_collections(id,path,singular,plural,config) VALUES ($1,'articles','article','articles','{}')",
        [collection]
      )
      await db.query('INSERT INTO byline_documents(id,collection_id) VALUES ($1,$2)', [
        doc,
        collection,
      ])
      await db.query(
        'INSERT INTO byline_document_versions(id,document_id,collection_id,collection_version) VALUES ($1,$2,$3,1)',
        [version, doc, collection]
      )
      const dir = new URL('sql/', assets)
      for (const file of readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        if (file.startsWith('0002'))
          await db.query(
            "UPDATE byline_documents SET source_locale='en' WHERE source_locale IS NULL"
          )
        await db.query(readFileSync(new URL(file, dir), 'utf8'))
        if (file.startsWith('0008'))
          await db.query(
            `INSERT INTO byline_document_publish_schedules
          (document_id,collection_id,target_version_id,publish_at,last_authorized_at,next_attempt_at)
          VALUES ($1,$2,$3,now(),now(),now())`,
            [doc, collection, version]
          )
      }
      await db.query(
        `INSERT INTO byline_store_file
        (id,document_version_id,collection_id,field_path,field_name,locale,file_id,filename,original_filename,mime_type,file_size,storage_provider,storage_path)
        VALUES(gen_random_uuid(),$1,$2,'cover','cover','all',gen_random_uuid(),'cover.png','cover.png','image/png',128,'local','images/cover.png')`,
        [version, collection]
      )
      await db.query(
        "INSERT INTO byline_admin_users(id,email,password) VALUES(gen_random_uuid(),'editor@example.org','fixture')"
      )
      const readonly = new URL(url)
      readonly.searchParams.set('options', '-c default_transaction_read_only=on')
      const inspect = () => inspectCoreStorage(readonly.href)
      expect((await inspect()).findings.map((f) => f.check)).toEqual(['version-locale-coverage'])
      await db.query("INSERT INTO byline_document_version_locales VALUES ($1,'all')", [version])
      expect(await inspect()).toMatchObject({
        state: 'recognized',
        observed: 15,
        inspection: 'catalog and content',
      })
      expect(
        (await db.query('SELECT state,suspended_reason FROM byline_document_publish_schedules'))
          .rows[0]
      ).toEqual({ state: 'needs_reconfirm', suspended_reason: 'upgrade_invalidated' })
      await db.query("UPDATE byline_document_publish_schedules SET state='armed'")
      expect((await inspect()).findings[0]?.check).toBe('schedule-authorization')
      await db.query("UPDATE byline_document_publish_schedules SET state='needs_reconfirm'")
      await db.query(
        "INSERT INTO byline_document_paths(document_id,collection_id,locale,path) VALUES ($1,$2,'en','news')",
        [doc, collection]
      )
      await db.query('UPDATE byline_document_versions SET is_deleted=true')
      expect((await inspect()).findings[0]?.check).toBe('path-liveness')
      await db.query('UPDATE byline_document_paths SET deleted_at=now()')
      await db.query("UPDATE byline_documents SET source_locale=' '")
      expect((await inspect()).findings[0]?.check).toBe('source-locale')
      await db.query("UPDATE byline_documents SET source_locale='en'")
      expect((await inspect()).state).toBe('recognized')
      await db.query('ALTER TABLE byline_documents DROP CONSTRAINT check_documents_revision')
      expect((await inspect()).findings[0]?.check).toContain('check_documents_revision')
      expect(
        (await db.query("SELECT to_regclass('public.byline_core_migrations') AS j")).rows[0].j
      ).toBeNull()
      await db.query(
        'ALTER TABLE byline_documents ADD CONSTRAINT check_documents_revision CHECK (revision BETWEEN 1 AND 9007199254740991)'
      )
      // A type rewrite re-parses dependent CHECKs exactly as pg_dump/restore does,
      // pushing the varchar IN array cast into each element. Status must still match.
      for (const column of ['state', 'suspended_reason'])
        for (const type of ['varchar(64)', 'varchar(32)'])
          await db.query(
            `ALTER TABLE byline_document_publish_schedules ALTER COLUMN ${column} TYPE ${type}`
          )
      expect(
        (
          await db.query(
            "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='check_document_publish_schedules_state'"
          )
        ).rows[0].def
      ).toContain("ARRAY[('armed'::character varying)::text")
      expect(await inspect()).toMatchObject({ state: 'recognized', findings: [] })
      expect(await adoptCoreStorage(url.href)).toEqual({ adopted: true, version: 15 })
      expect(await adoptCoreStorage(url.href)).toEqual({ adopted: false, version: 15 })
      expect(
        (
          await db.query(
            'SELECT storage_validator_kind,storage_validator_value FROM byline_store_file'
          )
        ).rows
      ).toEqual([{ storage_validator_kind: null, storage_validator_value: null }])
      expect((await db.query('SELECT email FROM byline_admin_users')).rows[0].email).toBe(
        'editor@example.org'
      )
      await db.query('UPDATE byline_document_versions SET is_deleted=false')
      await db.query('UPDATE byline_document_paths SET deleted_at=NULL')
      await db.query(
        "UPDATE byline_document_publish_schedules SET state='armed',authorized_revision=1,suspended_reason=NULL,suspended_at=NULL"
      )
      expect(
        (await db.query('SELECT source_locale FROM byline_current_documents')).rows[0].source_locale
      ).toBe('en')
      // The same future SQL must converge from a native adoption and a fresh installer.
      const base = loadStorageSteps()[0]!
      const sql = 'CREATE TABLE public.convergence_fixture(id integer PRIMARY KEY)'
      const steps = [
        base,
        {
          ...base,
          version: 16,
          compatible_from: 16,
          name: 'convergence',
          sql,
          sha256: createHash('sha256').update(sql).digest('hex'),
          relations: { r: ['convergence_fixture'] },
        },
      ]
      expect(await migrateOnConnection(db, database, steps)).toEqual({ applied: [16] })
      await db.query('SET search_path TO pg_catalog')
      const coreTables = [...base.relations.r!, ...base.relations.v!]
      expect(catalogFindings(await readCutoverCatalog(db, coreTables))).toEqual([])
      const suffix = await readCutoverCatalog(db, ['convergence_fixture'])
      await withTarget(async ({ url: freshUrl }) => {
        const fresh = new Client({ connectionString: freshUrl.href })
        await fresh.connect()
        try {
          expect(await installOnConnection(fresh, steps)).toEqual({ applied: [15, 16] })
          await fresh.query('SET search_path TO pg_catalog')
          expect(catalogFindings(await readCutoverCatalog(fresh, coreTables))).toEqual([])
          expect(await readCutoverCatalog(fresh, ['convergence_fixture'])).toEqual(suffix)
        } finally {
          await fresh.end()
        }
      })
      expect((await host.query('SELECT * FROM host_sentinel')).rows).toEqual([{ id: 42 }])
    } finally {
      await db.end()
    }
  })
})

it('recognizes a fresh catalog, checks immutable historical anchors and diagnoses missing privileges', async () => {
  await withTarget(async ({ host, url, role }) => {
    await host.query(baseline)
    expect(await inspectCoreStorage(url.href)).toMatchObject({ state: 'inaccessible' })
    await host.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`)
    await host.query(
      "INSERT INTO byline_collections(id,path,singular,plural,config) VALUES ($1,'articles','article','articles','{}')",
      [collection]
    )
    await host.query(
      "INSERT INTO byline_documents(id,collection_id,source_locale,revision) VALUES ($1,$2,'fr',2)",
      [doc, collection]
    )
    const next = '44444444-4444-4444-8444-444444444444'
    for (const [id, summary] of [
      [version, 'draft'],
      [next, 're-anchored content source locale en → fr'],
    ]) {
      await host.query(
        "INSERT INTO byline_document_versions(id,document_id,collection_id,collection_version,event_type,change_summary) VALUES ($1,$2,$3,1,'update',$4)",
        [id, doc, collection, summary]
      )
      for (const [locale, path] of [
        ['en', 'title'],
        ['fr', 'title'],
        ['fr', 'excerpt'],
      ]) {
        await host.query(
          'INSERT INTO byline_store_text(id,collection_id,document_version_id,field_path,field_name,locale,value) VALUES(gen_random_uuid(),$1,$2,$3,$3,$4,$4::varchar)',
          [collection, id, path, locale]
        )
      }
      await host.query("INSERT INTO byline_document_version_locales VALUES ($1,'fr')", [id])
    }
    await host.query("INSERT INTO byline_document_version_locales VALUES ($1,'en')", [version])
    expect(await inspectCoreStorage(url.href)).toMatchObject({
      state: 'recognized',
      supportedServerMajors: '15–18',
    })
    // Preserve view columns and types but change row visibility. Both definitions must be compared.
    for (const name of ['byline_current_documents', 'byline_current_published_documents']) {
      const view = (
        await host.query('SELECT pg_get_viewdef($1::regclass) AS definition', [name])
      ).rows[0].definition.replace(/;\s*$/, '')
      await host.query(`CREATE OR REPLACE VIEW ${name} AS SELECT * FROM (${view}) s WHERE false`)
      expect(
        (await inspectCoreStorage(url.href)).findings.some((f) => f.check === `${name}/view`)
      ).toBe(true)
      await host.query(`CREATE OR REPLACE VIEW ${name} AS ${view}`)
    }
    await host.query(
      "DELETE FROM byline_document_version_locales WHERE document_version_id=$1 AND locale='en'",
      [version]
    )
    expect((await inspectCoreStorage(url.href)).findings[0]?.check).toBe('version-locale-coverage')
    await host.query(
      'ALTER TABLE byline_documents ADD COLUMN blocks_writes integer NOT NULL DEFAULT 0'
    )
    await host.query('ALTER TABLE byline_documents ALTER COLUMN blocks_writes DROP DEFAULT')
    expect((await inspectCoreStorage(url.href)).findings[0]?.check).toContain('blocks_writes')
  })
})

it('distinguishes journal and unjournaled states and preserves the target', async () => {
  await withTarget(async ({ host, url, role, database }) => {
    expect((await inspectCoreStorage(url.href)).state).toBe('unrelated')
    await host.query('DROP TABLE host_sentinel')
    expect((await inspectCoreStorage(url.href)).state).toBe('empty')
    const steps = loadStorageSteps()
    const future = {
      ...steps[0]!,
      version: 16,
      compatible_from: 16,
      relations: { r: ['future_test_table'] },
    }
    await host.query('CREATE TABLE future_test_table(id integer)')
    expect((await readStatus(host, database, [...steps, future])).findings[0]?.check).toBe(
      'unjournaled-later-step'
    )
    await host.query('DROP TABLE future_test_table')
    await installCoreStorage(url.href)
    expect((await inspectCoreStorage(url.href)).state).toBe('current')
    expect(await readStatus(host, database, [...steps, future])).toMatchObject({
      state: 'pending',
      pending: [16],
    })
    await host.query(
      "INSERT INTO byline_core_migrations SELECT 16, installation_id,'migrated','applied','fenced',16,sha256,now() FROM byline_core_migrations WHERE version=15"
    )
    expect((await inspectCoreStorage(url.href)).state).toBe('newer')
    await host.query("UPDATE byline_core_migrations SET state='applying' WHERE version=16")
    expect((await inspectCoreStorage(url.href)).state).toBe('interrupted')
    await host.query('UPDATE byline_core_migrations SET version=17 WHERE version=16')
    expect((await inspectCoreStorage(url.href)).state).toBe('corrupt')
    await host.query(`REVOKE USAGE ON SCHEMA public FROM PUBLIC,${role}`)
    expect((await inspectCoreStorage(url.href)).state).toBe('inaccessible')
  })
})
