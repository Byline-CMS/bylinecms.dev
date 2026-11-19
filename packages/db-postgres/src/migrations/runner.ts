import { randomUUID } from 'node:crypto'

import type { Client } from 'pg'

import type { StorageStep } from './assets.js'

const journal = 'byline_core_migrations'
const journalFormat = 'byline/core-storage-migrations/v1'
const lockKey = 1682231442
const journalRelations = { r: [journal], i: [`${journal}_pkey`] }
const journalColumns = [
  'version:integer',
  'installation_id:uuid',
  'origin:text',
  'state:text',
  'classification:text',
  'compatible_from:integer',
  'sha256:text',
  'applied_at:timestamp with time zone',
]

interface JournalRow {
  version: number
  installation_id: string
  origin: string
  state: string
  classification: string
  compatible_from: number
  sha256: string
}

async function checkSession(client: Client) {
  const { rows } = await client.query<{
    schema: string
    path: string
    crypto: boolean
    writable: boolean
    temporary: boolean
  }>(`SELECT current_schema() AS schema, current_setting('search_path') AS path,
      EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') AS crypto,
      has_schema_privilege('public','USAGE') AND has_schema_privilege('public','CREATE') AS writable, pg_my_temp_schema() <> 0 AS temporary`)
  const settings = rows[0]
  if (
    settings?.temporary ||
    settings?.schema !== 'public' ||
    !['"$user",public', 'public'].includes(settings.path.replaceAll(' ', ''))
  ) {
    throw new Error(
      'Core installation requires public as the target schema and the default or public search_path'
    )
  }
  if (!settings.crypto)
    throw new Error('PostgreSQL core installation requires the pgcrypto extension')
  if (!settings.writable)
    throw new Error('Core installation requires USAGE and CREATE on schema public')
  await client.query('SET search_path TO public, pg_temp')
}

async function checkInventory(
  client: Client,
  relations: Record<string, string[]>,
  installed: boolean
) {
  const expected = new Map(
    Object.entries(relations).flatMap(([kind, names]) => names.map((name) => [name, kind] as const))
  )
  const names = [...expected.keys()]
  const { rows } = await client.query<{ name: string; kind: string }>(
    `SELECT relname AS name, relkind AS kind FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::name[])`,
    [names]
  )
  if (installed) {
    const actual = new Map(rows.map((row) => [row.name, row.kind]))
    for (const [name, kind] of expected) {
      if (actual.get(name) !== kind)
        throw new Error(
          `Expected public.${name} of kind ${kind}; found ${actual.get(name) ?? 'missing'}`
        )
    }
    return
  }
  if (rows.length) {
    throw new Error(
      `Core installation found occupied objects: ${rows.map((row) => `public.${row.name}`).join(', ')}. For existing core storage, consult the target release's native SQL upgrade guide; this installer cannot adopt it.`
    )
  }
  const rowTypes = [...(relations.r ?? []), ...(relations.v ?? [])]
  const types = await client.query<{ name: string }>(
    `SELECT typname AS name FROM pg_catalog.pg_type
    WHERE typnamespace = 'public'::regnamespace AND typname = ANY($1::name[]) ORDER BY typelem <> 0, typname`,
    [rowTypes.flatMap((name) => [name, `_${name}`])]
  )
  if (types.rows.length)
    throw new Error(`Core installation would collide with type public.${types.rows[0]?.name}`)
}

async function readJournal(client: Client, steps: StorageStep[]): Promise<JournalRow[]> {
  const exists = await client.query("SELECT to_regclass('public.byline_core_migrations') AS name")
  if (!exists.rows[0].name) return []
  const metadata = await client.query<{ columns: string[]; valid: boolean }>(
    `SELECT
    ARRAY(SELECT a.attname || ':' || format_type(a.atttypid,a.atttypmod)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND a.attnotnull AND NOT a.atthasdef AND a.attgenerated='' AND a.attidentity='' ORDER BY a.attnum) AS columns,
    (obj_description(c.oid,'pg_class') = $1 AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relrowsecurity AND NOT c.relispartition
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)
      AND (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)=8
      AND (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=c.oid AND contype <> 'n')=1
      AND EXISTS (SELECT FROM pg_catalog.pg_constraint WHERE conrelid=c.oid AND contype='p' AND conkey=ARRAY[1]::smallint[])) AS valid
    FROM pg_catalog.pg_class c WHERE c.oid='public.byline_core_migrations'::regclass`,
    [journalFormat]
  )
  if (!metadata.rows[0]?.valid || metadata.rows[0].columns.join('|') !== journalColumns.join('|')) {
    throw new Error('Incompatible journal definition at public.byline_core_migrations')
  }
  const { rows } = await client.query<JournalRow>(
    'SELECT * FROM public.byline_core_migrations ORDER BY version'
  )
  if (!rows.length) throw new Error('Empty PostgreSQL core journal: inspection required')
  for (const [index, row] of rows.entries()) {
    const step = steps[index]
    if (
      !step ||
      row.version !== step.version ||
      row.sha256 !== step.sha256 ||
      row.state !== 'applied' ||
      row.classification !== step.classification ||
      row.compatible_from !== step.compatible_from ||
      row.installation_id !== rows[0]?.installation_id ||
      !(index === 0 ? ['installed', 'adopted'] : ['migrated']).includes(row.origin)
    ) {
      throw new Error(
        `Unsupported or inconsistent PostgreSQL core journal at version ${row.version}`
      )
    }
  }
  return rows
}

// The caller owns this physical connection and closes it on every exit, including a
// lost commit acknowledgement. PostgreSQL releases its session lock on disconnect.
export async function installOnConnection(client: Client, steps: StorageStep[]) {
  await checkSession(client)
  await client.query("SET lock_timeout = '10s'")
  try {
    await client.query('SELECT pg_catalog.pg_advisory_lock($1)', [lockKey])
  } catch (cause) {
    const holder = await client
      .query(
        `SELECT pid FROM pg_catalog.pg_locks
      WHERE locktype='advisory' AND granted AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
        AND classid=0 AND objid=$1 AND objsubid=1`,
        [lockKey]
      )
      .catch(() => null)
    throw new Error(
      `PostgreSQL core migration lock ${lockKey} unavailable after bounded wait; holder ${holder?.rows[0]?.pid ?? 'unavailable'}. Inspect the active job and retry.`,
      { cause }
    )
  }
  const history = await readJournal(client, steps)
  const id = history[0]?.installation_id ?? randomUUID()
  for (const step of steps.slice(0, history.length))
    await checkInventory(client, step.relations, true)
  const applied: number[] = []
  for (const step of steps.slice(history.length)) {
    await client.query('BEGIN')
    try {
      if (step === steps[0]) await checkInventory(client, journalRelations, false)
      await checkInventory(client, step.relations, false)
      if (step === steps[0]) {
        await client.query(`CREATE TABLE public.byline_core_migrations (
        version integer PRIMARY KEY, installation_id uuid NOT NULL, origin text NOT NULL,
        state text NOT NULL, classification text NOT NULL, compatible_from integer NOT NULL,
        sha256 text NOT NULL, applied_at timestamptz NOT NULL)`)
        await client.query(`COMMENT ON TABLE public.byline_core_migrations IS '${journalFormat}'`)
      }
      await client.query(step.sql)
      await checkInventory(client, step.relations, true)
      await client.query(
        `INSERT INTO public.byline_core_migrations
        (version,installation_id,origin,state,classification,compatible_from,sha256,applied_at)
        VALUES ($1,$2,$3,'applied',$4,$5,$6,now())`,
        [
          step.version,
          id,
          step === steps[0] ? 'installed' : 'migrated',
          step.classification,
          step.compatible_from,
          step.sha256,
        ]
      )
      await client.query('COMMIT')
      applied.push(step.version)
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {})
      throw new Error(
        `PostgreSQL core migration ${step.version} failed. Inspect and retry with the same release. ${cause instanceof Error ? cause.message : cause}`,
        { cause }
      )
    }
  }
  return { applied }
}
