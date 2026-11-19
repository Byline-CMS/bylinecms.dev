import type { Pool } from 'mysql2/promise'

import { loadSteps, type MysqlStep, prefix } from './assets.js'
import { journal, rows } from './catalog.js'
import { readHistory } from './history.js'
import { readPrivileges } from './privileges.js'

/** Read-only admission for both application and worker boot. */
export async function assertRuntimeStorage(pool: Pool, steps: MysqlStep[] = loadSteps()) {
  const connection = await pool.getConnection()
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION READ ONLY')
    const [session] = await rows(connection, 'SELECT DATABASE() AS db,CURRENT_USER() AS account')
    if (!session?.db) throw Error('MySQL runtime requires an explicitly selected database.')
    const database = String(session.db),
      target = steps.at(-1)!.version
    const has = await readPrivileges(connection, database)
    const shape = prefix(
      steps.flatMap((s) => s.stages),
      Infinity
    )
    const objects = new Map(
      (
        await rows(
          connection,
          'SELECT TABLE_NAME AS name,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'
        )
      ).map((r) => [String(r.name), r.kind])
    )
    for (const [name, lines] of shape) {
      const table = lines.some((line) => line.startsWith('CREATE TABLE '))
      if (objects.get(name) !== (table ? 'BASE TABLE' : 'VIEW'))
        throw Error(
          `MySQL runtime cannot see required ${table ? 'table' : 'view'} ${name}; verify schema and grants.`
        )
      for (const priv of table ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] : ['SELECT'])
        if (!has(name, priv)) throw Error(`MySQL runtime needs ${priv} on ${name}.`)
    }
    let history: Awaited<ReturnType<typeof readHistory>>
    try {
      history = await readHistory(connection, database, steps)
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE' && target === 10) {
        return {
          warning:
            'Unjournaled MySQL core checkpoint: run byline storage status and adopt with writers fenced before the first post-0010 upgrade.',
        }
      }
      throw Error(
        `MySQL runtime requires a readable, valid byline_core_migrations journal. ${(error as Error).message}`
      )
    }
    const last = history.at(-1)
    if (last?.state !== 'applied' || last.version < target)
      throw Error(
        'MySQL core migration is missing, pending or applying. Stop readiness and complete supervised storage migration.'
      )
    for (const row of history.filter((r) => r.version > target))
      if (
        row.state !== 'applied' ||
        row.classification !== 'online' ||
        row.compatible_from > target
      )
        throw Error('Newer MySQL core schema requires a matching release or fenced restore.')
    if (!has(journal, 'SELECT')) throw Error('MySQL runtime needs SELECT on the core journal.')
    if (history[0]!.recorded_by !== session.account) {
      for (const priv of [
        'INSERT',
        'UPDATE',
        'DELETE',
        'ALTER',
        'DROP',
        'CREATE',
        'TRIGGER',
        'INDEX',
        'INSERT COLUMN',
        'UPDATE COLUMN',
      ])
        if (has(journal, priv))
          throw Error(
            `Split-role MySQL runtime has ${priv} on the core journal. Grant SELECT only.`
          )
    }
  } finally {
    try {
      await connection.rollback()
      connection.release()
    } catch {
      connection.destroy()
    }
  }
}
