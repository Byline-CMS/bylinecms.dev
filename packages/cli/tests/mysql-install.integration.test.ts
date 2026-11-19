import { randomBytes } from 'node:crypto'

import { hasInterruptedInstall, installCoreStorage } from '@byline/db-mysql/migrations'
import { type Connection, createConnection } from 'mysql2/promise'
import { expect, it } from 'vitest'

import { resetTestDatabase } from '../../db-mysql/dist/lib/test-db.js'
import { loadBaseline } from '../../db-mysql/dist/migrations/assets.js'
import { rows } from '../../db-mysql/dist/migrations/catalog.js'
import { installOnConnection, withLock } from '../../db-mysql/dist/migrations/runner.js'

const step = loadBaseline()
async function fixture(work: (url: URL, admin: Connection, name: string) => Promise<void>) {
  const url = new URL(process.env.BYLINE_CLI_MYSQL_ADMIN_URL ?? '')
  if (url.protocol !== 'mysql:' || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('MySQL migration fixtures require a loopback test server')
  const connection = await createConnection(url.href)
  const name = `byline_cli_recovery_${randomBytes(5).toString('hex')}_test`
  try {
    await connection.query(
      `CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    )
    url.pathname = name
    console.info(
      'MySQL recovery fixture',
      name,
      (await rows(connection, 'SELECT VERSION() AS v'))[0]?.v
    )
    await work(url, connection, name)
  } finally {
    await connection.query(`DROP DATABASE IF EXISTS ${name}`)
    await connection.end()
  }
}

it.each([
  ['journal', 0],
  ['intent', 0],
  ['ddl', 64],
  ['ddl', step.stages.length],
] as const)('recovers after session loss at %s %i', async (point, stage) =>
  fixture(async (url) => {
    const first = await createConnection(url.href)
    await expect(
      installOnConnection(first, step, {
        fault: (kind, n) => {
          if (kind === point && n === stage) {
            first.destroy()
            throw new Error('lost physical connection')
          }
        },
      })
    ).rejects.toThrow('lost physical connection')
    expect(await hasInterruptedInstall(url.href)).toBe(true)
    const second = await createConnection(url.href)
    try {
      const history = await rows(second, 'SELECT * FROM byline_core_migrations')
      if (point === 'journal') expect(history).toHaveLength(0)
      else
        expect(history).toMatchObject([
          { state: 'applying', stage: Math.max(0, stage - 1), completed_at: null },
        ])
      expect(await installCoreStorage(url.href, { resumeOnly: true })).toMatchObject({
        changed: true,
        version: 10,
      })
      expect(await rows(second, 'SELECT * FROM byline_core_migrations')).toMatchObject([
        { state: 'applied', stage: step.stages.length },
      ])
      expect(await installOnConnection(second, step)).toMatchObject({ changed: false })
    } finally {
      await second.end()
    }
  })
)

it('diagnoses a non-prefix definition repeatedly and resumes after a fenced scoped repair', async () =>
  fixture(async (url) => {
    const first = await createConnection(url.href)
    try {
      await expect(
        installOnConnection(first, step, {
          fault: (point, n) => {
            if (point === 'ddl' && n === 2) throw new Error('interrupted')
          },
        })
      ).rejects.toThrow('interrupted')
      await first.query('ALTER TABLE byline_admin_passkey_attempts ADD unexpected INT NOT NULL')
      for (let retry = 0; retry < 2; retry++) {
        await expect(installCoreStorage(url.href)).rejects.toThrow(
          /stage 1 object byline_admin_passkey_attempts.*unexpected/s
        )
        expect(await rows(first, 'SELECT state,stage FROM byline_core_migrations')).toMatchObject([
          { state: 'applying', stage: 1 },
        ])
      }
      await first.query('ALTER TABLE byline_admin_passkey_attempts DROP COLUMN unexpected')
      expect(await installCoreStorage(url.href)).toMatchObject({ changed: true })
      await first.query('CREATE TABLE host_sentinel (id INT PRIMARY KEY)')
      await first.query('INSERT INTO host_sentinel VALUES (42)')
      await resetTestDatabase(url.href)
      expect(await rows(first, 'SELECT * FROM host_sentinel')).toMatchObject([{ id: 42 }])
      expect(await rows(first, 'SELECT version FROM byline_core_migrations')).toMatchObject([
        { version: 10 },
      ])
    } finally {
      await first.end()
    }
  }))

it('serializes simultaneous installations and bounds lock contention with restricted process visibility', async () =>
  fixture(async (url, admin, name) => {
    const account = `byline_lock_${randomBytes(5).toString('hex')}`
    const password = randomBytes(20).toString('hex')
    const a = await createConnection(url.href)
    try {
      await admin.query(`CREATE USER '${account}'@'%' IDENTIFIED BY ?`, [password])
      await admin.query(`GRANT ALL ON \`${name}\`.* TO '${account}'@'%'`)
      const other = new URL(url.href)
      other.username = account
      other.password = password
      const b = await createConnection(other.href)
      try {
        await withLock(a, name, 1, async () => {
          await expect(installOnConnection(b, step, { lockSeconds: 0 })).rejects.toThrow(
            /after 0s \(holder unavailable\).*Retry/
          )
        })
        const results = await Promise.all([
          installOnConnection(a, step),
          installOnConnection(b, step),
        ])
        expect(results.map((r) => r.changed).sort()).toEqual([false, true])
      } finally {
        await b.end()
      }
    } finally {
      await a.end()
      await admin.query(`DROP USER IF EXISTS '${account}'@'%'`)
    }
  }))
