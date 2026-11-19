import { type ChildProcess, fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

import { installCoreStorage } from '@byline/db-postgres/migrations'
import { Client } from 'pg'
import { expect, it } from 'vitest'

import { loadStorageSteps, type StorageStep } from '../../../db-postgres/dist/migrations/assets.js'
import {
  migrateOnConnection,
  onlineOnConnection,
} from '../../../db-postgres/dist/migrations/operations.js'
import { withTarget } from '../postgres-target.js'

async function reply(child: ChildProcess) {
  const ac = new AbortController()
  try {
    const [response] = await Promise.race([
      once(child, 'message', { signal: ac.signal }),
      once(child, 'exit', { signal: ac.signal }).then(([code]) => {
        throw Error(`Consumer exited ${code}`)
      }),
    ])
    if (response.error) throw Error(response.error)
    return response.result
  } finally {
    ac.abort()
  }
}
async function call(child: ChildProcess, action: string, label?: string, id?: string) {
  const response = reply(child)
  child.send({ action, label, id })
  return response
}

it('runs released and candidate readers, writers and workers at each online checkpoint and restores the fenced recovery point', async () => {
  await withTarget(async ({ host, url, database }) => {
    const admin = new Client({ connectionString: process.env.BYLINE_CLI_POSTGRES_ADMIN_URL })
    const backup = database.replace('coexist', 'restore')
    const children: ChildProcess[] = []
    let saved = false
    const stop = async () => {
      for (const child of children.splice(0)) {
        if (!child.connected) continue
        const exit = once(child, 'exit')
        child.send({ action: 'stop' })
        await exit
      }
    }
    const start = async (root: string, name: string, endpoint = url) => {
      const child = fork(
        fileURLToPath(new URL('./postgres-consumer.mjs', import.meta.url)),
        [root, name],
        {
          execArgv: [],
          env: { ...process.env, BYLINE_DB_POSTGRES_CONNECTION_STRING: endpoint.href },
        }
      )
      children.push(child)
      expect(await reply(child)).toBe('ready')
      return child
    }
    const oldRoot = process.env.BYLINE_TEST_RELEASE_DIRECTORY!
    const release = process.env.BYLINE_TEST_PREVIOUS_RELEASE ?? '6.13.4'
    const currentRoot = fileURLToPath(new URL('../../../../packages/client/', import.meta.url))
    await admin.connect()
    try {
      await installCoreStorage(url.href)
      const old = await start(oldRoot, 'prior')
      const checkpointDoc = await call(old, 'cycle', 'restore point')
      await stop()
      // Use PostgreSQL's quiescent template copy as a database-wide recovery point.
      await host.end()
      await admin.query(`CREATE DATABASE ${backup} TEMPLATE ${database}`)
      saved = true
      const previous = await start(oldRoot, 'prior')
      const current = await start(currentRoot, 'candidate')
      const runtime = new Client({ connectionString: url.href })
      await runtime.connect()
      try {
        const base = loadStorageSteps()[0]!
        const {
          rows: [col],
        } = await runtime.query(
          "SELECT id FROM byline_collections WHERE path='compatibility-articles'"
        )
        await runtime.query(
          "INSERT INTO byline_documents(id,collection_id,revision,source_locale) SELECT gen_random_uuid(),$1,1,'en' FROM generate_series(1,100000)",
          [col.id]
        )
        const steps = [base]
        async function migrate() {
          const direct = new Client({ connectionString: url.href })
          await direct.connect()
          try {
            return await onlineOnConnection(direct, database, runtime, database, steps, [release])
          } finally {
            await direct.end()
          }
        }
        for (const version of [15, 16, 17]) {
          if (version > 15) {
            const sql = `ALTER TABLE public.byline_documents ADD COLUMN compatibility_fixture_${version} text`
            const step: StorageStep = {
              version,
              name: 'compatibility_fixture',
              sql,
              sha256: createHash('sha256').update(sql).digest('hex'),
              classification: 'online',
              compatible_from: 15,
              relations: {},
              online: {
                tested_releases: {
                  [release]: 15,
                  ...(version === 17 ? { '0.0.0-intermediate': 16 } : {}),
                },
                evidence: 'Disposable cross-release workload',
                lock_timeout_ms: 150,
                statement_timeout_ms: 2000,
              },
            }
            steps.push(step)
            if (version === 16) {
              const blocker = new Client({ connectionString: url.href })
              await blocker.connect()
              try {
                await blocker.query('BEGIN')
                await blocker.query('LOCK TABLE byline_documents IN ACCESS SHARE MODE')
                const begin = performance.now()
                await expect(migrate()).rejects.toThrow(/lock timeout/)
                const elapsed = performance.now() - begin
                expect(elapsed).toBeLessThan(2000)
                console.info('100000-row contention abort (ms)', elapsed)
              } finally {
                await blocker.end()
              }
            }
            const begin = performance.now()
            expect((await migrate()).applied).toEqual([version])
            console.info(
              '100000-row additive migration',
              version,
              'elapsed ms',
              performance.now() - begin
            )
          }
          const labels = [`prior-${version}`, `candidate-${version}`]
          const [a, b] = await Promise.all([
            call(previous, 'cycle', labels[0]),
            call(current, 'cycle', labels[1]),
          ])
          await Promise.all([
            call(previous, 'read', labels[1], b),
            call(current, 'read', labels[0], a),
          ])
          for (const child of [previous, current]) {
            await call(child, 'worker') // First pass registers new tasks with a future due time.
            await runtime.query('UPDATE byline_recurring_tasks SET next_run_at=now()')
            expect(await call(child, 'worker')).toBeGreaterThan(0)
          }
        }
        await stop()
        const sql =
          'ALTER TABLE public.byline_documents RENAME COLUMN compatibility_fixture_17 TO fenced_fixture_18'
        const fenced = {
          version: 18,
          compatible_from: 18,
          classification: 'fenced' as const,
          name: 'fenced_fixture',
          sql,
          sha256: createHash('sha256').update(sql).digest('hex'),
          relations: {},
        }
        const operator = new Client({ connectionString: url.href })
        await operator.connect()
        try {
          expect(
            (await migrateOnConnection(operator, database, [...steps, fenced])).applied
          ).toEqual([18])
        } finally {
          await operator.end()
        }
      } finally {
        await runtime.end()
      }
      await stop()
      const restored = new URL(url)
      restored.pathname = `/${backup}`
      const prior = await start(oldRoot, 'restored', restored)
      expect(await call(prior, 'read', 'restore point', checkpointDoc)).toBe('restore point edited')
      const verify = new Client({ connectionString: restored.href })
      await verify.connect()
      try {
        expect((await verify.query('SELECT version FROM byline_core_migrations')).rows).toEqual([
          { version: 15 },
        ])
        expect(
          (await verify.query('SELECT count(*)::int AS n FROM byline_documents')).rows[0].n
        ).toBe(1)
      } finally {
        await verify.end()
      }
    } finally {
      await stop()
      if (saved) await admin.query(`DROP DATABASE ${backup}`)
      await admin.end()
    }
  })
}, 120000)
