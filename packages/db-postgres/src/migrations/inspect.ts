import type { Client } from 'pg'

import { catalogFindings, type Finding, readCutoverCatalog } from './catalog.js'
import { dataFindings } from './data-evidence.js'
import { JournalIssue, readJournal } from './runner.js'
import type { StorageStep } from './assets.js'

type State =
  | 'empty'
  | 'unrelated'
  | 'recognized'
  | 'partial'
  | 'current'
  | 'pending'
  | 'interrupted'
  | 'newer'
  | 'corrupt'
  | 'inaccessible'
  | 'unsupported-engine'
export interface StorageStatus {
  dialect: 'postgres'
  database: string
  schema: 'public'
  supportedServerMajors: string
  serverMajor?: number
  state: State
  inspection: 'journal' | 'catalog' | 'catalog and content'
  target: number
  observed: number | null
  pending: number[]
  installationId?: string
  findings: Finding[]
  next: string
}

const actions: Record<State, string> = {
  'unsupported-engine': 'Rehearse on a supported PostgreSQL release before adopting or migrating.',
  empty: 'Run byline setup.',
  unrelated: 'For a shared database use byline setup --database postgres --existing-database.',
  recognized: 'Fence all writers and workers, take a verified backup and run byline storage adopt.',
  partial: 'Resolve the reported discrepancies on a fenced restore before adoption.',
  current: 'No core migration is pending.',
  pending: 'Run byline storage migrate with writers fenced, or use the eligible release job.',
  interrupted: 'Keep deployment stopped. Inspect the matching release and restore point.',
  newer: 'Run status using the release that owns the newer journal.',
  corrupt: 'Keep writers fenced and reconcile the journal with a verified restore.',
  inaccessible: 'Verify the target, credentials and named privileges and run status again.',
}

export function storageStatus(
  database: string,
  steps: StorageStep[],
  state: State,
  fields: Partial<StorageStatus> = {}
): StorageStatus {
  return {
    dialect: 'postgres',
    database,
    schema: 'public',
    supportedServerMajors: '15–18',
    state,
    target: steps.at(-1)!.version,
    observed: null,
    inspection: 'catalog',
    findings: [],
    pending: [],
    next: actions[state],
    ...fields,
  }
}

// Caller owns the transaction. Standalone status uses REPEATABLE READ READ ONLY;
// adoption calls the same checks again after taking the lock.
export async function inspectOnConnection(
  client: Client,
  database: string,
  steps: StorageStep[],
  verifyBaseline = false,
  journalOnly = false
): Promise<StorageStatus> {
  const session =
    await client.query(`SELECT current_database() AS db, current_schema() AS schema, current_setting('server_version_num')::integer / 10000 AS major,
    current_setting('search_path') AS path, pg_my_temp_schema() <> 0 AS temporary,
    has_schema_privilege('public','USAGE') AS visible`)
  const settings = session.rows[0]
  const report = (state: State, fields?: Partial<StorageStatus>) =>
    storageStatus(database, steps, state, { serverMajor: settings.major, ...fields })
  if (settings.major < 15 || settings.major > 18) return report('unsupported-engine')
  if (
    settings.db !== database ||
    settings.schema !== 'public' ||
    settings.temporary ||
    !['"$user",public', 'public'].includes(settings.path.replaceAll(' ', '')) ||
    !settings.visible
  )
    return report('inaccessible', {
      findings: [
        {
          check: 'session',
          observed: 'Unexpected database, schema/search_path or missing USAGE on public.',
          remedy: actions.inaccessible,
        },
      ],
    })
  await client.query('SET LOCAL search_path TO pg_catalog')
  await client.query('SET LOCAL row_security TO off')
  const history = await readJournal(client, steps)
  if (history.length && !(verifyBaseline && history.length === 1)) {
    const latest = history.at(-1)!
    const pending = steps.slice(history.length).map((s) => s.version)
    return report(pending.length ? 'pending' : 'current', {
      inspection: 'journal',
      observed: latest.version,
      installationId: latest.installation_id,
      pending,
    })
  }
  if (journalOnly)
    return report('partial', {
      inspection: 'journal',
      findings: [
        {
          check: 'missing-journal',
          observed: 'Core storage has no migration journal.',
          remedy:
            'Run byline storage status and supervise installation or adoption before retrying.',
        },
      ],
    })
  const baseline = steps[0]!.relations
  const names = Object.values(baseline).flat()
  const tables = [...(baseline.r ?? []), ...(baseline.v ?? [])]
  const future = steps.slice(1).flatMap((step) => Object.values(step.relations).flat())
  const { rows } = await client.query<{ name: string }>(
    `SELECT relname AS name FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::name[])
    UNION SELECT typname FROM pg_type WHERE typnamespace='public'::regnamespace AND typname=ANY($2::name[])`,
    [
      [...names, ...future, 'byline_core_migrations_pkey'],
      [...tables, ...future, 'byline_core_migrations'].flatMap((n) => [n, `_${n}`]),
    ]
  )
  const newerEffect = rows.find((row) => future.includes(row.name))
  if (newerEffect)
    return report('partial', {
      findings: [
        {
          check: 'unjournaled-later-step',
          observed: newerEffect.name,
          remedy: 'Rehearse a scoped reversion or restore the verified checkpoint before adoption.',
        },
      ],
    })
  if (!rows.length) {
    const { rows: objects } =
      await client.query(`SELECT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S','f')
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) AS present`)
    return report(objects[0].present ? 'unrelated' : 'empty')
  }
  const findings = catalogFindings(await readCutoverCatalog(client, tables))
  if (
    !history.length &&
    rows.some((row) =>
      ['byline_core_migrations_pkey', 'byline_core_migrations', '_byline_core_migrations'].includes(
        row.name
      )
    )
  )
    findings.push({
      check: 'journal-name-collision',
      observed: 'A reserved journal name is occupied.',
      remedy: actions.partial,
    })
  if (findings.length) return report('partial', { findings })
  const missing = await client.query(
    `SELECT name FROM unnest($1::text[]) name WHERE NOT has_table_privilege(format('public.%I',name),'SELECT')`,
    [tables]
  )
  if (missing.rows.length)
    return report('inaccessible', {
      findings: missing.rows.map((r) => ({
        check: 'privilege',
        observed: `Missing SELECT on public.${r.name}`,
        remedy: actions.inaccessible,
      })),
    })
  const data = await dataFindings(client)
  return report(data.length ? 'partial' : 'recognized', {
    inspection: 'catalog and content',
    findings: data,
    observed: data.length ? null : steps[0]!.version,
  })
}

export async function readStatus(
  client: Client,
  database: string,
  steps: StorageStep[],
  journalOnly = false
) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    return await inspectOnConnection(client, database, steps, false, journalOnly)
  } catch (error) {
    if (error instanceof JournalIssue)
      return storageStatus(database, steps, error.state, {
        inspection: 'journal',
        observed: error.version ?? null,
        findings: [{ check: 'journal', observed: error.message, remedy: actions[error.state] }],
      })
    if ((error as { code?: string }).code === '42501')
      return storageStatus(database, steps, 'inaccessible', {
        findings: [
          { check: 'privilege', observed: (error as Error).message, remedy: actions.inaccessible },
        ],
      })
    throw error
  } finally {
    await client.query('ROLLBACK')
  }
}
