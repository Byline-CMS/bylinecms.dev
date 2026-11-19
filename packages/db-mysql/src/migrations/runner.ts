import { createHash, randomUUID } from 'node:crypto'

import type { Connection, RowDataPacket } from 'mysql2/promise'

import { assertMySqlVersion } from '../lib/boot-check.js'
import { advance, type MysqlStep, prefix } from './assets.js'
import { assertDefinition, createJournal, definition, journal, rows } from './catalog.js'
import { verifyCatalogFormat } from './format.js'
import { readPrivileges } from './privileges.js'

type Fault = (point: 'journal' | 'intent' | 'ddl', stage: number) => void

export async function migrationSession(connection: Connection, probe = false) {
  const [s] = await rows(
    connection,
    `SELECT VERSION() AS version, DATABASE() AS db, @@foreign_key_checks AS fk,
    @@unique_checks AS uq, @@autocommit AS ac, @@default_storage_engine AS engine,
    @@collation_database AS collation, @@sql_quote_show_create AS quoted`
  )
  await assertMySqlVersion(async () => [{ v: s?.version }])
  if (
    !s?.db ||
    !s.fk ||
    !s.uq ||
    !s.ac ||
    !s.quoted ||
    s.engine !== 'InnoDB' ||
    s.collation !== 'utf8mb4_0900_ai_ci'
  )
    throw new Error(
      'Select an InnoDB utf8mb4_0900_ai_ci database with autocommit, quoted catalog identifiers and FK, UNIQUE and CHECK enforcement enabled'
    )
  if (probe) await verifyCatalogFormat(connection)
  return { database: String(s.db), version: String(s.version) }
}

export async function withLock<T>(
  connection: Connection,
  database: string,
  seconds: number,
  work: () => Promise<T>
) {
  const name = `byline-core-${createHash('sha256').update(database.toLowerCase()).digest('hex').slice(0, 48)}`
  const [lock] = await rows(connection, 'SELECT GET_LOCK(?, ?) AS acquired', [name, seconds])
  if (lock?.acquired !== 1) {
    let holder = 'holder unavailable'
    try {
      const [process] = await rows(
        connection,
        'SELECT ID FROM information_schema.PROCESSLIST WHERE ID = IS_USED_LOCK(?)',
        [name]
      )
      if (process) holder = `holder connection ${process.ID}`
    } catch {
      /* Process visibility is optional. */
    }
    throw new Error(
      `MySQL ${database}: lock ${name} unavailable after ${seconds}s (${holder}). Retry after the other migration finishes.`
    )
  }
  let result: T
  try {
    result = await work()
  } catch (error) {
    await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {})
    throw error
  }
  await connection.query('SELECT RELEASE_LOCK(?)', [name])
  return result
}

export async function inventory(connection: Connection) {
  return new Set(
    (
      await rows(
        connection,
        'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'
      )
    ).map((r) => String(r.name))
  )
}

// Prove schema-wide visibility before interpreting an absent name. Include global
// and schema grants; MySQL interprets the latter's escaped wildcard characters.
export async function requireSchemaPrivileges(
  connection: Connection,
  database: string,
  required: string[]
) {
  const has = await readPrivileges(connection, database)
  for (const name of required) {
    if (!has(undefined, name))
      throw new Error(
        `MySQL installer requires schema-wide ${name} on ${database}; grant this privilege to the migration account or one of its active roles.`
      )
  }
}

// Native ALTER TABLE scripts append columns. Adapter writes address them by
// name. Preserve their definitions and the ordered columns of every key.
export function logicalTable(lines: string[]) {
  return lines.map((line) => line.replace(/^column \d+ /, 'column ')).sort()
}

export async function verifyPrefix(
  connection: Connection,
  database: string,
  step: MysqlStep,
  count: number,
  actualNames: Set<string>,
  dedicated: boolean,
  allowNext: boolean,
  adopted = false
) {
  const expected = prefix(step.stages, count)
  const all = new Set(step.stages.map((stage) => stage.object))
  if (dedicated) {
    const extra = [...actualNames].filter((name) => name !== journal && !all.has(name))
    if (extra.length)
      throw new Error(
        `Occupied MySQL installation target: ${extra.join(', ')}. Preserve existing objects and select an empty dedicated database.`
      )
  }
  const triggers = await rows(
    connection,
    'SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS subject FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
  )
  for (const trigger of triggers)
    if (all.has(trigger.subject) || trigger.subject === journal)
      throw new Error(
        `Unexpected trigger ${trigger.name} on ${trigger.subject}; fence and repair before resuming.`
      )
  const next = allowNext ? step.stages[count] : undefined
  let ahead = false
  for (const name of all) {
    const before = expected.get(name) ?? []
    const actual = actualNames.has(name) ? await definition(connection, database, name) : []
    if (next?.object === name && JSON.stringify(actual) === JSON.stringify(advance(before, next))) {
      ahead = true
      continue
    }
    assertDefinition(
      `MySQL ${database} version ${step.version} at stage ${count} object ${name}`,
      adopted ? logicalTable(before) : before,
      adopted ? logicalTable(actual) : actual
    )
  }
  return ahead
}

export function validateBaselineRow(row: RowDataPacket, step: MysqlStep) {
  if (
    row.version !== step.version ||
    row.format_version !== 1 ||
    row.digest !== step.sha256 ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(row.installation_id) ||
    !['installed', 'adopted'].includes(row.origin) ||
    !['applying', 'applied'].includes(row.state) ||
    row.classification !== step.classification ||
    row.compatible_from !== step.compatible_from ||
    !row.recorded_by ||
    !Number.isInteger(row.stage) ||
    row.stage < 0 ||
    row.stage > step.stages.length ||
    (row.state === 'applied'
      ? !row.completed_at || row.stage !== step.stages.length
      : row.completed_at !== null || row.origin !== 'installed')
  )
    throw new Error(
      'Corrupt MySQL core migration history at baseline 0010; fence writers and inspect the journal.'
    )
}

export async function installOnConnection(
  connection: Connection,
  step: MysqlStep,
  options: { fault?: Fault; lockSeconds?: number; resumeOnly?: boolean } = {}
) {
  const { database } = await migrationSession(connection, true)
  return withLock(connection, database, options.lockSeconds ?? 5, async () => {
    await requireSchemaPrivileges(connection, database, [
      'SELECT',
      'INSERT',
      'UPDATE',
      'ALTER',
      'CREATE',
      'INDEX',
      'REFERENCES',
      'CREATE VIEW',
      'SHOW VIEW',
      'TRIGGER',
    ])
    const names = await inventory(connection)
    let row: RowDataPacket | undefined
    if (names.has(journal)) {
      assertDefinition(journal, step.journal, await definition(connection, database, journal))
      const history = await rows(
        connection,
        'SELECT * FROM byline_core_migrations ORDER BY version'
      )
      if (history.length > 1)
        throw new Error(
          'MySQL journal is ahead of the installer or corrupt; inspect with the matching adapter.'
        )
      row = history[0]
      if (row) validateBaselineRow(row, step)
    } else if (options.resumeOnly) throw new Error('No interrupted MySQL installation to resume.')
    if (options.resumeOnly && row?.state === 'applied')
      throw new Error('The dedicated database is already installed.')
    const count = row?.stage ?? 0
    const ahead = await verifyPrefix(
      connection,
      database,
      step,
      count,
      names,
      row?.state !== 'applied',
      row?.state === 'applying',
      row?.origin === 'adopted'
    )
    if (row?.state === 'applied') return { database, version: step.version, changed: false }
    if (!names.has(journal)) {
      await connection.query(createJournal)
      options.fault?.('journal', 0)
      assertDefinition(journal, step.journal, await definition(connection, database, journal))
    }
    if (!row) {
      await connection.query(
        `INSERT INTO byline_core_migrations
        (version,format_version,installation_id,origin,digest,state,classification,compatible_from,stage,recorded_by)
        VALUES (?,1,?,'installed',?,'applying',?,?,0,CURRENT_USER())`,
        [step.version, randomUUID(), step.sha256, step.classification, step.compatible_from]
      )
      options.fault?.('intent', 0)
    }
    const state = prefix(step.stages, count)
    for (let index = count; index < step.stages.length; index++) {
      const stage = step.stages[index]!
      const before = state.get(stage.object) ?? []
      const after = advance(before, stage)
      if (!(ahead && index === count)) {
        const current = names.has(stage.object)
          ? await definition(connection, database, stage.object)
          : []
        assertDefinition(`stage ${index + 1} ${stage.object}`, before, current)
        await connection.query(step.statements[index]!)
        options.fault?.('ddl', index + 1)
      }
      assertDefinition(
        `stage ${index + 1} ${stage.object}`,
        after,
        await definition(connection, database, stage.object)
      )
      names.add(stage.object)
      state.set(stage.object, after)
      await connection.query('UPDATE byline_core_migrations SET stage=? WHERE version=?', [
        index + 1,
        step.version,
      ])
    }
    await verifyPrefix(
      connection,
      database,
      step,
      step.stages.length,
      await inventory(connection),
      true,
      false
    )
    await connection.query(
      "UPDATE byline_core_migrations SET state='applied',completed_at=UTC_TIMESTAMP(6) WHERE version=?",
      [step.version]
    )
    return { database, version: step.version, changed: true }
  })
}
