import type { Pool } from 'pg'

import { loadStorageSteps, type StorageStep } from './assets.js'
import { readJournal } from './runner.js'

/** Runtime checks never acquire the migration lock or change database state. */
export async function assertRuntimeStorage(pool: Pool, steps: StorageStep[] = loadStorageSteps()) {
  const target = steps.at(-1)
  if (!target) throw new Error('Core storage manifest has no target version')
  const client = await pool.connect()
  let discard = false
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const {
      rows: [session],
    } = await client.query(`SELECT pg_catalog.current_schema() AS schema,
      pg_catalog.has_schema_privilege('public','USAGE') AS usable, pg_catalog.pg_my_temp_schema() <> 0 AS temporary`)
    if (!session?.usable) throw new Error('Core runtime needs USAGE on schema public.')
    if (session.schema !== 'public' || session.temporary)
      throw new Error('Core runtime requires public as its effective schema.')
    // Runtime queries use unqualified names; verify they resolve to the objects we check.
    const relations = steps.flatMap((step) =>
      Object.entries(step.relations).flatMap(([kind, names]) =>
        ['r', 'v', 'S'].includes(kind) ? names.map((name) => ({ name, kind })) : []
      )
    )
    const { rows: missing } = await client.query(
      `SELECT n AS name,priv FROM unnest($1::text[],$2::text[]) x(n,k)
      CROSS JOIN LATERAL unnest(CASE k WHEN 'r' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE']
        WHEN 'S' THEN ARRAY['USAGE'] ELSE ARRAY['SELECT'] END) priv
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=n
      WHERE c.oid IS NULL OR c.relkind::text<>k OR pg_catalog.to_regclass(pg_catalog.quote_ident(n)) IS DISTINCT FROM c.oid
        OR NOT CASE WHEN k='S' THEN pg_catalog.has_sequence_privilege(c.oid,priv)
          ELSE pg_catalog.has_table_privilege(c.oid,priv) END ORDER BY n,priv LIMIT 1`,
      [relations.map((r) => r.name), relations.map((r) => r.kind)]
    )
    await client.query('SET LOCAL search_path TO pg_catalog')
    const {
      rows: [journal],
    } = await client.query(`SELECT c.relkind, has_table_privilege(c.oid,'SELECT') AS readable,
      pg_get_userbyid(c.relowner)<>current_user AND (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      OR has_any_column_privilege(c.oid,'UPDATE,INSERT') OR pg_has_role(c.relowner,'MEMBER')) AS writable
      FROM pg_class c WHERE c.oid=to_regclass('public.byline_core_migrations')`)
    if (journal?.relkind === 'r' && !journal.readable)
      throw new Error('Core runtime needs SELECT on public.byline_core_migrations.')
    if (journal?.writable)
      throw new Error(
        'The split runtime role can write public.byline_core_migrations. Restrict journal writes to the migration owner.'
      )
    const history = await readJournal(client, steps, 'runtime')
    const observed = history.at(-1)?.version
    if (observed === undefined && target.version > 15)
      throw new Error(
        'Core migration journal missing. Fence writers, run byline storage status and adopt the verified checkpoint before upgrading.'
      )
    if (observed !== undefined && observed < target.version)
      throw new Error(
        `Core storage is at ${observed}; runtime needs ${target.version}. Run byline storage migrate before startup.`
      )
    if (missing[0])
      throw new Error(
        `Core runtime needs public.${missing[0].name} with ${missing[0].priv} privilege. Verify the schema and runtime grants.`
      )
    if (observed === undefined)
      return {
        warning:
          'PostgreSQL core storage is unjournaled. Run byline storage status, then fence writers and run byline storage adopt before the next schema upgrade.',
      }
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      discard = true
    }
    client.release(discard)
  }
}
