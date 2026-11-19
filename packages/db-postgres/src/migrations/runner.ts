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

export async function checkSession(client: Client) {
  const { rows } = await client.query<{
    schema: string
    path: string
    crypto: boolean
    readonly: boolean
    writable: boolean
    temporary: boolean
  }>(`SELECT current_schema() AS schema, current_setting('search_path') AS path,
      current_setting('transaction_read_only')::boolean AS readonly,
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
  if (settings.readonly)
    throw new Error('PostgreSQL core migration requires a writable direct connection.')
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
      `Core installation found occupied objects: ${rows.map((row) => `public.${row.name}`).join(', ')}. For existing core storage, consult the target release's native SQL upgrade guide; run byline storage status before explicit adoption.`
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

export class JournalIssue extends Error {
  constructor(
    readonly state: 'corrupt' | 'newer' | 'interrupted',
    message: string,
    readonly version?: number
  ) {
    super(message)
  }
}

export async function readJournal(
  client: Pick<Client, 'query'>,
  steps: StorageStep[],
  mode: 'operator' | 'runtime' = 'operator'
): Promise<JournalRow[]> {
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
    throw new JournalIssue(
      'corrupt',
      'Incompatible journal definition at public.byline_core_migrations'
    )
  }
  const { rows } = await client.query<JournalRow>(
    'SELECT * FROM public.byline_core_migrations ORDER BY version'
  )
  if (!rows.length)
    throw new JournalIssue('corrupt', 'Empty PostgreSQL core journal: inspection required')
  for (const [index, row] of rows.entries()) {
    const step = steps[index]
    const previousFloor = rows[index - 1]?.compatible_from ?? row.version
    const validFloor =
      row.classification === 'fenced'
        ? row.compatible_from === row.version
        : row.classification === 'online' &&
          row.compatible_from >= previousFloor &&
          row.compatible_from < row.version
    const expectedOrigin = index === 0 ? ['installed', 'adopted'] : ['migrated']
    if (
      row.version !== steps[0]!.version + index ||
      row.installation_id !== rows[0]?.installation_id ||
      !expectedOrigin.includes(row.origin) ||
      !validFloor ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      (step &&
        (row.version !== step.version ||
          row.sha256 !== step.sha256 ||
          row.classification !== step.classification ||
          row.compatible_from !== step.compatible_from)) ||
      (row.state !== 'applied' && !(row.state === 'applying' && index === rows.length - 1))
    ) {
      throw new JournalIssue(
        'corrupt',
        `Unsupported or inconsistent PostgreSQL core journal at version ${row.version}`,
        row.version
      )
    }
  }
  const latest = rows.at(-1)!
  if (latest.state === 'applying')
    throw new JournalIssue(
      'interrupted',
      `Unexpected applying row in the transactional PostgreSQL journal at ${latest.version}; inspect the matching release and recovery point.`,
      latest.version
    )

  if (
    latest.version > steps.at(-1)!.version &&
    (mode === 'operator' || latest.compatible_from > steps.at(-1)!.version)
  )
    throw new JournalIssue(
      'newer',
      `PostgreSQL core journal is at newer version ${latest.version}`,
      latest.version
    )
  return rows
}

// The caller owns this physical connection and closes it on every exit, including a
// lost commit acknowledgement. PostgreSQL releases its session lock on disconnect.
export async function installOnConnection(client: Client, steps: StorageStep[]) {
  await checkSession(client)
  await acquireCoreLock(client)
  return applyStorageSteps(client, steps, await readJournal(client, steps))
}

export async function acquireCoreLock(client: Client) {
  await client.query("SET lock_timeout = '10s'")
  try {
    await client.query('SELECT pg_catalog.pg_advisory_lock($1)', [lockKey])
  } catch (cause) {
    const holder = await client
      .query(
        `SELECT current_database() AS db, (SELECT pid FROM pg_catalog.pg_locks
      WHERE locktype='advisory' AND granted AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
        AND classid=0 AND objid=$1 AND objsubid=1 LIMIT 1) AS pid`,
        [lockKey]
      )
      .catch(() => null)
    throw new Error(
      `PostgreSQL core migration lock ${lockKey} on ${holder?.rows[0]?.db ?? 'the target database'} unavailable after 10s; holder ${holder?.rows[0]?.pid ?? 'unavailable'}. Inspect the active job and retry.`,
      { cause }
    )
  }
}

// A live release job requires one direct/session connection. Recheck lock ownership
// inside every transaction so a session switch cannot execute migration SQL.
export async function requireCoreLock(client: Client) {
  const { rows } = await client.query(
    `SELECT EXISTS(SELECT FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted
    AND pid=pg_catalog.pg_backend_pid() AND classid=0 AND objid=$1 AND objsubid=1
    AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())) AS held`,
    [lockKey]
  )
  if (!rows[0]?.held)
    throw new Error(
      'Core migration session lost its lock. Configure a direct PostgreSQL endpoint and run status before retrying.'
    )
}

export async function createJournal(client: Client) {
  await client.query(`CREATE TABLE public.byline_core_migrations (
        version integer PRIMARY KEY, installation_id uuid NOT NULL, origin text NOT NULL,
        state text NOT NULL, classification text NOT NULL, compatible_from integer NOT NULL,
        sha256 text NOT NULL, applied_at timestamptz NOT NULL)`)
  await client.query(`COMMENT ON TABLE public.byline_core_migrations IS '${journalFormat}'`)
}

export async function recordStep(
  client: Client,
  step: StorageStep,
  id: string,
  origin: 'installed' | 'adopted' | 'migrated'
) {
  await client.query(
    `INSERT INTO public.byline_core_migrations
        (version,installation_id,origin,state,classification,compatible_from,sha256,applied_at)
        VALUES ($1,$2,$3,'applied',$4,$5,$6,now())`,
    [step.version, id, origin, step.classification, step.compatible_from, step.sha256]
  )
}

export async function commitStep(client: Client, version: number) {
  try {
    await client.query('COMMIT')
  } catch (cause) {
    throw new Error(
      `Commit outcome unknown for core version ${version}. Reconnect and run byline storage status before retrying.`,
      { cause }
    )
  }
}

export async function applyStorageSteps(
  client: Client,
  steps: StorageStep[],
  history: JournalRow[]
) {
  const id = history[0]?.installation_id ?? randomUUID()
  for (const step of steps.slice(0, history.length))
    await checkInventory(client, step.relations, true)
  const applied: number[] = []
  for (const step of steps.slice(history.length)) {
    await client.query('BEGIN')
    try {
      await requireCoreLock(client)
      if (step.online) {
        await client.query(
          "SELECT pg_catalog.set_config('lock_timeout',$1,true),pg_catalog.set_config('statement_timeout',$2,true)",
          [String(step.online.lock_timeout_ms), String(step.online.statement_timeout_ms)]
        )
      }
      if (step === steps[0]) await checkInventory(client, journalRelations, false)
      await checkInventory(client, step.relations, false)
      if (step === steps[0]) {
        await createJournal(client)
      }
      await client.query(step.sql)
      await checkInventory(client, step.relations, true)
      await recordStep(client, step, id, step === steps[0] ? 'installed' : 'migrated')
      await commitStep(client, step.version)
      applied.push(step.version)
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {})
      throw new Error(
        `PostgreSQL core migration ${step.version} did not return success. Last acknowledged core version: ${applied.at(-1) ?? history.at(-1)?.version ?? 'none'}. Inspect and retry with the same release. ${cause instanceof Error ? cause.message : cause}`,
        { cause }
      )
    }
  }
  return { applied }
}
