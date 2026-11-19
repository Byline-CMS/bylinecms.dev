import { type ChildProcess, fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

import { installCoreStorage } from '@byline/db-mysql/migrations'
import { createConnection, createPool } from 'mysql2/promise'
import { expect, it } from 'vitest'

import { loadBaseline } from '../../../db-mysql/dist/migrations/assets.js'
import { rows } from '../../../db-mysql/dist/migrations/catalog.js'
import { migrateOnConnection } from '../../../db-mysql/dist/migrations/operations.js'
import { assertRuntimeStorage } from '../../../db-mysql/dist/migrations/runtime.js'
import { onlineColumns } from '../mysql-steps.js'
import { withMysqlTarget } from '../mysql-target.js'
import { call, reply } from './consumer-ipc.js'

it(
  'runs the actual prior and candidate writers and workers at every durable online DDL prefix',
  async () =>
    withMysqlTarget(async (url) => {
      const release = process.env.BYLINE_TEST_PREVIOUS_RELEASE ?? '6.13.4'
      const baseline = loadBaseline(),
        step = onlineColumns(baseline, release)
      const direct = await createConnection(url.href),
        runtime = await createConnection(url.href),
        control = await createConnection(url.href),
        blocker = await createConnection(url.href)
      const pool = createPool({ uri: url.href, connectionLimit: 1 })
      const children: ChildProcess[] = []
      const start = async (root: string, label: string) => {
        const child = fork(
          fileURLToPath(new URL('./storage-consumer.mjs', import.meta.url)),
          [root, label, 'mysql'],
          { execArgv: [], env: { ...process.env, BYLINE_DB_MYSQL_CONNECTION_STRING: url.href } }
        )
        children.push(child)
        expect(await reply(child)).toBe('ready')
        return child
      }
      try {
        await installCoreStorage(url.href)
        const old = await start(process.env.BYLINE_TEST_RELEASE_DIRECTORY!, 'prior')
        const candidate = await start(
          fileURLToPath(new URL('../../../db-mysql/', import.meta.url)),
          'candidate'
        )
        const exercise = async (label: string) => {
          const [a, b] = await Promise.all([
            call(old, 'cycle', `prior-${label}`),
            call(candidate, 'cycle', `candidate-${label}`),
          ])
          await Promise.all([
            call(candidate, 'read', `prior-${label}`, a),
            call(old, 'read', `candidate-${label}`, b),
          ])
          for (const child of [old, candidate]) {
            await call(child, 'worker')
            await runtime.query('UPDATE byline_recurring_tasks SET next_run_at=NOW(6)')
            expect(await call(child, 'worker')).toBeGreaterThan(0)
          }
        }
        await exercise('baseline')
        const digits =
          '(SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)'
        const [collection] = await rows(
          direct,
          "SELECT id FROM byline_collections WHERE path='compatibility-articles'"
        )
        await direct.query(
          `INSERT INTO byline_documents(id,collection_id,source_locale,revision)
      SELECT UUID(),?,'en',1 FROM ${[0, 1, 2, 3, 4].map((i) => `${digits} n${i}`).join(' CROSS JOIN ')}`,
          [collection!.id]
        )
        const opts = { runtime, control, deployedReleases: [release] }
        const stages: number[] = []
        let stageStarted = performance.now()
        const result = await migrateOnConnection(direct, [baseline, step], {
          ...opts,
          afterDdl: async (_v, stage) => {
            console.info(
              'MySQL 100000-row stage',
              stage,
              'elapsed ms',
              performance.now() - stageStarted
            )
            stages.push(stage)
            await expect(assertRuntimeStorage(pool, [baseline])).rejects.toThrow(/applying/)
            await exercise(`ddl-${stage}`)
            stageStarted = performance.now()
          },
        })
        expect(result.applied).toEqual([11])
        expect(stages).toEqual([1, 2])
        await exercise('complete')
        await assertRuntimeStorage(pool, [baseline])
        const suffix = {
          ...step,
          version: 12,
          statements: [
            'ALTER TABLE `byline_documents` ADD COLUMN `fixture_c` INT NULL, ALGORITHM=INPLACE, LOCK=NONE',
          ],
          stages: [{ object: 'byline_documents', add: ['column 10 `fixture_c` int DEFAULT NULL'] }],
          online: { ...step.online!, tested_releases: { [release]: 10, '0.0.0-intermediate': 11 } },
        }
        await blocker.beginTransaction()
        await blocker.query('SELECT id FROM byline_documents LIMIT 1')
        const begin = performance.now()
        await expect(migrateOnConnection(direct, [baseline, step, suffix], opts)).rejects.toThrow(
          /lock wait timeout/i
        )
        const elapsed = performance.now() - begin
        expect(elapsed).toBeLessThan(5000)
        console.info('MySQL 100000-row contention abort (ms)', elapsed)
        await blocker.rollback()
        expect(
          await rows(direct, 'SELECT version,state FROM byline_core_migrations ORDER BY version')
        ).toMatchObject([
          { version: 10, state: 'applied' },
          { version: 11, state: 'applied' },
          { version: 12, state: 'applying' },
        ])
        await expect(migrateOnConnection(direct, [baseline, step, suffix], opts)).rejects.toThrow(
          /supervised recovery/
        )
        expect((await migrateOnConnection(direct, [baseline, step, suffix])).applied).toEqual([12])
      } finally {
        for (const child of children) {
          if (child.connected) {
            const closed = once(child, 'exit')
            child.send({ action: 'stop' })
            await closed
          }
        }
        await blocker.end()
        await control.end()
        await runtime.end()
        await direct.end()
        await pool.end()
      }
    }),
  120000
)
