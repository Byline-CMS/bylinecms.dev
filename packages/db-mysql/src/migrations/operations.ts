import type { Connection, RowDataPacket } from 'mysql2/promise'

import { advance, checkSuffix, type MysqlStep, prefix } from './assets.js'
import { assertDefinition, definition, journal, rows } from './catalog.js'
import { readHistory } from './history.js'
import {
  inventory,
  logicalTable,
  migrationSession,
  requireSchemaPrivileges,
  withLock,
} from './runner.js'

export interface ReleasePlan {
  target: number
  deployedReleases: readonly string[]
  pending: { version: number; classification: string; testedReleases: string[] }[]
}
type Options = {
  runtime?: Connection
  deployedReleases?: readonly string[]
  report?: (plan: ReleasePlan) => void
  control?: Connection
  afterDdl?: (version: number, stage: number) => void | Promise<void>
}

async function predicate(connection: Connection, sql: string) {
  const found = await rows(connection, sql)
  return found.length === 1 && Number(Object.values(found[0]!)[0]) === 1
}

// At most one DDL can have committed ahead of its receipt. Transactional DML
// commits its receipt on the same session, so its state cannot be one ahead.
export async function verifyUpgradePrefix(
  connection: Connection,
  database: string,
  steps: MysqlStep[],
  version: number,
  count: number,
  applying: boolean,
  adopted: boolean
) {
  const completed = steps.filter((step) => step.version < version).flatMap((step) => step.stages)
  const current = steps.find((step) => step.version === version)
  const stages = [...completed, ...(current?.stages.slice(0, count) ?? [])]
  const shape = prefix(stages, stages.length)
  const names = await inventory(connection)
  const claimed = new Set(steps.flatMap((s) => s.stages.map((stage) => stage.object)))
  const next = applying ? current?.stages[count] : undefined
  const normalize = adopted ? logicalTable : (lines: string[]) => lines
  let ahead = false
  for (const object of claimed) {
    const expected = shape.get(object) ?? []
    const actual = names.has(object) ? await definition(connection, database, object) : []
    if (
      next?.object === object &&
      !next.data &&
      JSON.stringify(normalize(advance(expected, next))) === JSON.stringify(normalize(actual))
    ) {
      ahead = true
      continue
    }
    assertDefinition(
      `version ${version} stage ${count} ${object}`,
      normalize(expected),
      normalize(actual)
    )
  }
  for (const trigger of await rows(
    connection,
    'SELECT TRIGGER_NAME AS name,EVENT_OBJECT_TABLE AS subject FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
  ))
    if (claimed.has(trigger.subject) || trigger.subject === journal)
      throw Error(`Unexpected trigger ${trigger.name} on ${trigger.subject}`)
  for (const completed of current?.stages.slice(0, count) ?? [])
    if (completed.data && !(await predicate(connection, completed.data.after)))
      throw Error(
        `Data postcondition failed at version ${version} stage ${count} on ${completed.object}`
      )
  return { shape, ahead }
}

async function boundedDdl(
  connection: Connection,
  control: Connection | undefined,
  sql: string,
  step: MysqlStep,
  runnerId: number | undefined
) {
  const budget = step.online?.statement_timeout_ms
  if (!control || !budget) {
    await connection.query(sql)
    return
  }
  if (runnerId === undefined) throw Error('Unverified MySQL cancellation target')
  // MAX_EXECUTION_TIME applies only to SELECT. A second authenticated session
  // cancels only the active statement on this runner's own pinned connection.
  let cancel: Promise<unknown> | undefined
  const timer = setTimeout(() => {
    cancel = control.query({ sql: `KILL QUERY ${runnerId}`, timeout: 1000 }).catch(() => {
      connection.destroy()
    })
  }, budget)
  let failure: unknown
  try {
    await connection.query(sql)
  } catch (error) {
    failure = error
  } finally {
    clearTimeout(timer)
  }
  if (cancel) {
    await cancel
    throw Error(
      'MySQL statement budget exceeded; inspect the applying stage before supervised recovery.'
    )
  }
  if (failure) throw failure
}

async function applyStep(
  connection: Connection,
  database: string,
  steps: MysqlStep[],
  step: MysqlStep,
  first: RowDataPacket,
  existing: RowDataPacket | undefined,
  options: Options,
  runnerId: number | undefined
) {
  const count = existing?.stage ?? 0,
    adopted = first.origin === 'adopted'
  const { shape, ahead } = await verifyUpgradePrefix(
    connection,
    database,
    steps,
    step.version,
    count,
    Boolean(existing),
    adopted
  )
  if (!existing)
    await connection.query(
      `INSERT INTO byline_core_migrations
    (version,format_version,installation_id,origin,digest,state,classification,compatible_from,stage,recorded_by)
    VALUES (?,1,?,'migrated',?,'applying',?,?,0,CURRENT_USER())`,
      [step.version, first.installation_id, step.sha256, step.classification, step.compatible_from]
    )
  if (options.runtime && step.online) {
    const seconds = Math.max(1, Math.ceil(step.online.lock_timeout_ms / 1000))
    await connection.query('SET SESSION lock_wait_timeout=?, SESSION innodb_lock_wait_timeout=?', [
      seconds,
      seconds,
    ])
  }
  for (let i = count; i < step.stages.length; i++) {
    const stage = step.stages[i]!,
      sql = step.statements[i]!,
      before = shape.get(stage.object) ?? [],
      after = advance(before, stage)
    const receipt = () =>
      connection.query('UPDATE byline_core_migrations SET stage=? WHERE version=?', [
        i + 1,
        step.version,
      ])
    if (stage.data) {
      await connection.beginTransaction()
      try {
        if (!(await predicate(connection, stage.data.before)))
          throw Error(`Data precondition failed for ${stage.object}`)
        await connection.query(sql)
        if (!(await predicate(connection, stage.data.after)))
          throw Error(`Data postcondition failed for ${stage.object}`)
        await receipt()
        await connection.commit()
      } catch (error) {
        await connection.rollback().catch(() => {})
        throw error
      }
    } else {
      if (!(i === count && ahead)) {
        const actual = before.length ? await definition(connection, database, stage.object) : []
        assertDefinition(
          stage.object,
          adopted ? logicalTable(before) : before,
          adopted ? logicalTable(actual) : actual
        )
        await boundedDdl(connection, options.control, sql, step, runnerId)
        await options.afterDdl?.(step.version, i + 1)
      }
      const actual = await definition(connection, database, stage.object)
      assertDefinition(
        stage.object,
        adopted ? logicalTable(after) : after,
        adopted ? logicalTable(actual) : actual
      )
      await receipt()
    }
    shape.set(stage.object, after)
  }
  await verifyUpgradePrefix(
    connection,
    database,
    steps,
    step.version,
    step.stages.length,
    false,
    adopted
  )
  await connection.query(
    "UPDATE byline_core_migrations SET state='applied',completed_at=UTC_TIMESTAMP(6) WHERE version=?",
    [step.version]
  )
}

export async function directSessionId(writer: Connection, control: Connection) {
  const [runner] = await rows(writer, 'SELECT @@server_uuid AS id, CONNECTION_ID() AS session')
  const [watchdog] = await rows(control, 'SELECT @@server_uuid AS id, CONNECTION_ID() AS session')
  const id = Number(runner?.session)
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    id !== writer.threadId ||
    Number(watchdog?.session) !== control.threadId ||
    !runner?.id ||
    runner.id !== watchdog?.id ||
    id === Number(watchdog?.session)
  )
    throw Error(
      'MySQL release jobs need two direct sessions on the same server with matching SQL and handshake connection IDs.'
    )
  return id
}

export function checkFleet(
  pending: MysqlStep[],
  releases: readonly string[],
  observed: number,
  server: string
) {
  const contracts = new Map<string, number>()
  for (const step of pending) {
    if (
      step.classification !== 'online' ||
      !step.online?.server_versions.includes(server.split('-')[0]!) ||
      !releases.length
    )
      throw Error(
        `Online migration blocked at ${step.version} (${step.classification}); verify server and active writer inventory.`
      )
    for (const release of releases) {
      const contract = step.online.tested_releases[release]
      if (
        contract === undefined ||
        contract > observed ||
        (contracts.has(release) && contracts.get(release) !== contract)
      )
        throw Error(
          `Online migration blocked at ${step.version}: unproved or inconsistent contract for deployed release ${release}.`
        )
      contracts.set(release, contract)
    }
  }
}

export async function migrateOnConnection(
  connection: Connection,
  steps: MysqlStep[],
  options: Options = {}
) {
  for (const [i, step] of steps.slice(1).entries()) checkSuffix(step, steps[i]!)
  const { database, version: server } = await migrationSession(connection, true)
  return withLock(connection, database, 5, async () => {
    const history = await readHistory(connection, database, steps)
    const first = history[0],
      last = history.at(-1),
      target = steps.at(-1)!
    if (!first || !last || first.state !== 'applied')
      throw Error('Complete baseline installation or adoption before migration.')
    if (last.version > target.version) throw Error('MySQL journal is newer than this release.')
    const pending = steps.filter(
      (step) =>
        step.version > last.version || (step.version === last.version && last.state === 'applying')
    )
    let runnerId: number | undefined
    if (options.runtime) {
      const [endpoint] = await rows(options.runtime, 'SELECT DATABASE() AS db')
      if (endpoint?.db !== database)
        throw Error('Direct and runtime endpoints identify different MySQL databases.')
      const other = await readHistory(options.runtime, database, steps)
      if (
        other[0]?.installation_id !== first.installation_id ||
        other.at(-1)?.version !== last.version ||
        other.at(-1)?.state !== last.state ||
        other.at(-1)?.stage !== last.stage
      )
        throw Error('Direct and runtime endpoints identify different MySQL installations.')
      const releases = options.deployedReleases ?? []
      options.report?.({
        target: target.version,
        deployedReleases: releases,
        pending: pending.map((s) => ({
          version: s.version,
          classification: s.classification,
          testedReleases: Object.keys(s.online?.tested_releases ?? {}),
        })),
      })
      if (last.state !== 'applied')
        throw Error('MySQL migration is applying. Stop promotion and use supervised recovery.')
      checkFleet(pending, releases, last.version, server)
      if (!options.control)
        throw Error('Online MySQL DDL requires a dedicated cancellation connection.')
      runnerId = await directSessionId(connection, options.control)
    }
    if (pending.length)
      await requireSchemaPrivileges(connection, database, [
        'SELECT',
        'INSERT',
        'UPDATE',
        'ALTER',
        'CREATE',
        'INDEX',
        'REFERENCES',
        'SHOW VIEW',
        'TRIGGER',
      ])
    const applied: number[] = []
    for (const step of pending) {
      await applyStep(
        connection,
        database,
        steps,
        step,
        first,
        last.version === step.version ? last : undefined,
        options,
        runnerId
      )
      applied.push(step.version)
    }
    return { applied }
  })
}
