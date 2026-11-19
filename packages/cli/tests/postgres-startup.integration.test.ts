import { readFileSync } from 'node:fs'

import { initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { installCoreStorage } from '@byline/db-postgres/migrations'
import { expect, it, vi } from 'vitest'

import { loadStorageSteps } from '../../db-postgres/dist/migrations/assets.js'
import { assertRuntimeStorage } from '../../db-postgres/dist/migrations/runtime.js'
import { withTarget } from './postgres-target.js'

const i18n = {
  admin: { defaultLocale: 'en', locales: [] },
  content: { defaultLocale: 'en', locales: [] },
}
it('boots a non-owner DML role and gates the server and scheduled worker on history and grants', async () => {
  await withTarget(async ({ host, url, role }) => {
    const owner = new URL(process.env.BYLINE_CLI_POSTGRES_ADMIN_URL!)
    owner.pathname = url.pathname
    await installCoreStorage(owner.href)
    const [baseline] = loadStorageSteps()
    if (!baseline) throw Error('Missing baseline')
    const tables = baseline.relations.r!.map((n) => `public.${host.escapeIdentifier(n)}`).join(',')
    const views = baseline.relations.v!.map((n) => `public.${host.escapeIdentifier(n)}`).join(',')
    await host.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`)
    await host.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${tables} TO ${role}`)
    await host.query(`GRANT SELECT ON ${views},public.byline_core_migrations TO ${role}`)
    const db = pgAdapter({
      connectionString: url.href,
      collections: [],
      defaultContentLocale: 'en',
    })
    const boot = () =>
      initBylineCore({ collections: [], db, i18n, scheduledPublication: { enabled: true } })
    try {
      const ready = await boot()
      expect(ready.recurringTasks.some((t) => t.name === 'documents.publish-scheduled')).toBe(true)
      const {
        rows: [c],
      } = await db.pool.query(
        "INSERT INTO byline_collections(id,path,singular,plural,config) VALUES(gen_random_uuid(),'fixture','item','items','{}') RETURNING id"
      )
      const {
        rows: [d],
      } = await db.pool.query(
        "INSERT INTO byline_documents(id,collection_id,source_locale,revision) VALUES(gen_random_uuid(),$1,'en',1) RETURNING id",
        [c.id]
      )
      await db.pool.query('UPDATE byline_documents SET revision=2 WHERE id=$1', [d.id])
      expect(
        await ready.db.queries.documents.getDocumentRevision({
          collection_id: c.id,
          document_id: d.id,
        })
      ).toBe(2)
      await expect(db.pool.query('DELETE FROM byline_core_migrations')).rejects.toMatchObject({
        code: '42501',
      })
      await expect(db.pool.query('CREATE TABLE public.runtime_ddl(id int)')).rejects.toMatchObject({
        code: '42501',
      })
      const backfill = vi.spyOn(db, 'backfillSourceLocales')
      const check = () => assertRuntimeStorage(db.pool)
      await host.query(`REVOKE UPDATE ON byline_documents FROM ${role}`)
      await expect(boot()).rejects.toThrow(/byline_documents.*UPDATE/)
      await host.query(`GRANT UPDATE ON byline_documents TO ${role}`)
      await host.query(`REVOKE SELECT ON byline_core_migrations FROM ${role}`)
      await expect(boot()).rejects.toThrow(/SELECT on public.byline_core_migrations/)
      await host.query(`GRANT SELECT,UPDATE ON byline_core_migrations TO ${role}`)
      await expect(boot()).rejects.toThrow(/split runtime role/)
      await host.query(`REVOKE UPDATE ON byline_core_migrations FROM ${role}`)
      const future = {
        ...baseline,
        name: 'future',
        version: 16,
        classification: 'fenced' as const,
        compatible_from: 16,
        relations: {},
      }
      await expect(assertRuntimeStorage(db.pool, [baseline, future])).rejects.toThrow(
        /migrate before startup/
      )
      await host.query(
        "INSERT INTO byline_core_migrations SELECT 16,installation_id,'migrated','applied','online',15,repeat('a',64),now() FROM byline_core_migrations WHERE version=15"
      )
      await expect(check()).resolves.toBeUndefined()
      await host.query(
        "UPDATE byline_core_migrations SET classification='fenced',compatible_from=16 WHERE version=16"
      )
      await expect(boot()).rejects.toThrow(/newer version/)
      await host.query('UPDATE byline_core_migrations SET version=17 WHERE version=16')
      await expect(check()).rejects.toThrow(/inconsistent/i)
      await host.query('DELETE FROM byline_core_migrations WHERE version=17')
      await host.query("UPDATE byline_core_migrations SET state='applying'")
      await expect(boot()).rejects.toThrow(/applying/)
      await host.query("UPDATE byline_core_migrations SET state='applied',sha256=repeat('0',64)")
      await expect(boot()).rejects.toThrow(/inconsistent/)
      await host.query('UPDATE byline_core_migrations SET sha256=$1', [baseline.sha256])
      await host.query("COMMENT ON TABLE byline_core_migrations IS 'unrecognized-format'")
      await expect(boot()).rejects.toThrow(/Incompatible journal definition/)
      await host.query('DROP TABLE byline_core_migrations')
      expect(await check()).toMatchObject({ warning: expect.stringContaining('storage adopt') })
      await expect(assertRuntimeStorage(db.pool, [baseline, future])).rejects.toThrow(
        /journal missing/
      )
      await host.query('ALTER TABLE byline_documents DROP CONSTRAINT check_documents_revision')
      await expect(boot()).rejects.toThrow(/revision schema is incompatible/)
      expect(backfill).not.toHaveBeenCalled()
    } finally {
      await db.pool.end()
    }
  })
})

it('awaits guarded core before independent provider migrations and before the host starts its scheduler', () => {
  for (const path of [
    '../../../apps/webapp/byline/server.config.ts',
    '../../../apps/webapp/byline/server.config-pg.ts',
    '../src/templates/dialects/postgres/byline-examples/server.config.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const init = source.indexOf('const core = await initBylineCore')
    expect(init).toBeGreaterThan(-1)
    for (const call of source.matchAll(/await migrate(?:Search|Analytics)?\(db\.pool/g))
      expect(call.index).toBeGreaterThan(init)
    expect(source).toContain('await globalThis.__bylineCoreSingleton__')
  }
  const server = readFileSync(
    new URL('../../../apps/webapp/src/server.ts', import.meta.url),
    'utf8'
  )
  expect(server.indexOf("import '../byline/server.config.ts'")).toBeLessThan(
    server.indexOf('startBylineScheduler(getBylineCore())')
  )
})
