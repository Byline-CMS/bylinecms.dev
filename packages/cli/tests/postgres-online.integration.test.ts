import { createHash } from 'node:crypto'

import { installCoreStorage } from '@byline/db-postgres/migrations'
import { Client, type QueryResult } from 'pg'
import { expect, it } from 'vitest'

import { loadStorageSteps, type StorageStep } from '../../db-postgres/dist/migrations/assets.js'
import { onlineOnConnection } from '../../db-postgres/dist/migrations/operations.js'
import { withTarget } from './postgres-target.js'

const base = loadStorageSteps()[0]!
function onlineStep(version: number, sql?: string): StorageStep {
  const name = `online_fixture_${version}`
  const statement = sql ?? `CREATE TABLE public.${name}(id integer)`
  return {
    version,
    name,
    sql: statement,
    sha256: createHash('sha256').update(statement).digest('hex'),
    classification: 'online',
    compatible_from: 15,
    relations: { r: [name] },
    online: {
      evidence: 'Synthetic test-only release harness',
      tested_releases: version === 16 ? { '6.13.4': 15 } : { '6.13.4': 15, '6.14.0': 16 },
      lock_timeout_ms: 500,
      statement_timeout_ms: 1500,
    },
  }
}

async function job(url: URL, runtimeUrl: URL, steps: StorageStep[], fleet: string[]) {
  const direct = new Client({ connectionString: url.href }),
    runtime = new Client({ connectionString: runtimeUrl.href })
  try {
    await direct.connect()
    await runtime.connect()
    return await onlineOnConnection(
      direct,
      decodeURIComponent(url.pathname.slice(1)),
      runtime,
      decodeURIComponent(runtimeUrl.pathname.slice(1)),
      steps,
      fleet
    )
  } finally {
    await Promise.all([direct.end(), runtime.end()])
  }
}

it('preflights the complete release inventory before DDL and serializes eligible jobs', async () => {
  await withTarget(async ({ url, host }) => {
    const steps = [base, onlineStep(16), onlineStep(17)]
    await expect(job(url, url, steps, ['6.13.4'])).rejects.toThrow('missing-journal')
    await installCoreStorage(url.href)
    await expect(job(url, url, steps, [])).rejects.toThrow('supply the deployed')
    await expect(job(url, url, steps, ['6.13.4', '6.0.0'])).rejects.toThrow('6.0.0')
    const unproved = {
      ...steps[2]!,
      online: { ...steps[2]!.online!, tested_releases: { '6.13.3': 15, '6.14.0': 16 } },
    }
    await expect(job(url, url, [...steps.slice(0, 2), unproved], ['6.13.4'])).rejects.toThrow(
      'Blocked step 17'
    )
    await expect(
      job(
        url,
        url,
        [
          ...steps.slice(0, 2),
          { ...steps[2]!, classification: 'fenced', compatible_from: 17, online: undefined },
        ],
        ['6.13.4']
      )
    ).rejects.toThrow('Blocked step 17')
    const readonly = new URL(url)
    readonly.searchParams.set('options', '-c default_transaction_read_only=on')
    await expect(job(readonly, url, steps, ['6.13.4'])).rejects.toThrow('writable direct')
    expect(
      (await host.query("SELECT to_regclass('public.online_fixture_16') AS name")).rows[0].name
    ).toBeNull()
    const result = await Promise.all([
      job(url, readonly, steps, ['6.13.4']),
      job(url, readonly, steps, ['6.13.4']),
    ])
    expect(result.map((r) => r.applied).sort((a, b) => a.length - b.length)).toEqual([[], [16, 17]])
    expect((await job(url, readonly, steps, [])).applied).toEqual([])
    expect(
      (
        await host.query(
          'SELECT version,compatible_from FROM byline_core_migrations ORDER BY version'
        )
      ).rows.map((r) => [r.version, r.compatible_from])
    ).toEqual([
      [15, 15],
      [16, 15],
      [17, 15],
    ])
  })
})

it('retains the successful step and rolls back the failing transaction before promotion', async () => {
  await withTarget(async ({ url, host }) => {
    await installCoreStorage(url.href)
    const steps = [
      base,
      onlineStep(16),
      onlineStep(17, 'CREATE TABLE public.online_fixture_17 (id integer); SELECT 1/0'),
    ]
    await expect(job(url, url, steps, ['6.13.4'])).rejects.toThrow(
      /Stop promotion.*Last acknowledged core version: 16/
    )
    expect(
      (
        await host.query(
          "SELECT to_regclass('public.online_fixture_16') AS done,to_regclass('public.online_fixture_17') AS failed"
        )
      ).rows[0]
    ).toEqual({ done: 'online_fixture_16', failed: null })
    expect(
      (await host.query('SELECT version FROM byline_core_migrations ORDER BY version')).rows
    ).toEqual([{ version: 15 }, { version: 16 }])
  })
})

it('refuses unrelated runtime databases and mismatched installation identities', async () => {
  await withTarget(async ({ url, host, database }) => {
    await installCoreStorage(url.href)
    await withTarget(async ({ url: other, host: otherHost }) => {
      await installCoreStorage(other.href)
      await expect(job(url, other, [base], [])).rejects.toThrow('database names differ')
      // Two servers can use the same DB name. Exercise that path through the real direct and
      // runtime connections by changing the runtime-reported id on a read-only fixture proxy.
      const runtime = new Client({ connectionString: url.href })
      await runtime.connect()
      const otherId = (await otherHost.query('SELECT installation_id FROM byline_core_migrations'))
        .rows[0].installation_id
      const original = runtime.query.bind(runtime)
      Object.defineProperty(runtime, 'query', {
        value: async (...args: Parameters<typeof original>) => {
          const result = (await Reflect.apply(original, runtime, args)) as unknown as QueryResult
          if (String(args[0]).startsWith('SELECT * FROM public.byline_core_migrations'))
            for (const row of result.rows) row.installation_id = otherId
          return result
        },
      })
      try {
        await expect(
          onlineOnConnection(host, database, runtime, database, [base], [])
        ).rejects.toThrow('installation identifiers')
      } finally {
        await runtime.end()
      }
    })
    expect(
      (await host.query('SELECT count(*)::int AS n FROM byline_core_migrations')).rows[0].n
    ).toBe(1)
  })
})

it('stops before migration DDL if the locked session is lost', async () => {
  await withTarget(async ({ url, host, database }) => {
    await installCoreStorage(url.href)
    const direct = new Client({ connectionString: url.href })
    await direct.connect()
    const query = direct.query.bind(direct)
    Object.defineProperty(direct, 'query', {
      value: async (...args: Parameters<typeof query>) => {
        // Simulate a pool handing the transaction to a backend without this session lock.
        if (String(args[0]) === 'BEGIN') await query('SELECT pg_catalog.pg_advisory_unlock_all()')
        return Reflect.apply(query, direct, args)
      },
    })
    try {
      await expect(
        onlineOnConnection(direct, database, host, database, [base, onlineStep(16)], ['6.13.4'])
      ).rejects.toThrow('session lost its lock')
      expect(
        (await host.query("SELECT to_regclass('public.online_fixture_16') AS name")).rows[0].name
      ).toBeNull()
    } finally {
      await direct.end()
    }
  })
})
