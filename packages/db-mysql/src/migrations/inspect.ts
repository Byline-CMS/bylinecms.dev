import { randomUUID } from 'node:crypto'

import type { Connection } from 'mysql2/promise'

import { type MysqlStep, prefix } from './assets.js'
import { assertDefinition, createJournal, definition, journal, rows } from './catalog.js'
import { dataFindings } from './data-evidence.js'
import { validateHistory } from './history.js'
import { verifyUpgradePrefix } from './operations.js'
import {
  inventory,
  logicalTable,
  migrationSession,
  requireSchemaPrivileges,
  verifiedMysqlReleases,
  verifyPrefix,
  withLock,
} from './runner.js'

export interface Finding {
  check: string
  observed: string
  remedy: string
}
const actions = {
  empty: 'Use dedicated MySQL setup on this empty target.',
  unrelated: 'Use an empty dedicated database for MySQL setup.',
  recognized: 'Fence writers and workers, take a verified backup and run byline storage adopt.',
  partial: 'Rehearse the named repair on a fenced restore before adoption.',
  current: 'No core migration is pending.',
  pending: 'Run byline storage migrate after fencing writers.',
  interrupted:
    'Keep writers fenced. Repeat the original operation with the same target and inspect the named stage.',
  newer: 'Use the adapter release that owns the newer schema.',
  corrupt: 'Fence writers and reconcile the core journal with a verified restore.',
  inaccessible: 'Check the target, credentials and named privileges before retrying.',
  'unsupported-engine': 'Use an adapter with a verified MySQL catalog contract for this server.',
}

export interface StorageStatus {
  dialect: 'mysql'
  database: string
  schema: string
  supportedServerMajors: string
  serverVersion?: string
  serverMajor?: number
  inspection: 'catalog' | 'catalog and content' | 'journal'
  state: keyof typeof actions
  observed: number | null
  target: number
  pending: number[]
  findings: Finding[]
  installationId?: string
  next: string
}

export function status(
  database: string,
  step: MysqlStep,
  state: StorageStatus['state'],
  fields: Partial<StorageStatus> = {}
): StorageStatus {
  return {
    dialect: 'mysql',
    schema: database,
    database,
    supportedServerMajors: verifiedMysqlReleases.join(', '),
    target: step.version,
    observed: null,
    findings: [],
    pending: [],
    inspection: 'catalog',
    state,
    next: actions[state],
    ...fields,
  }
}

async function catalogEvidence(
  connection: Connection,
  database: string,
  step: MysqlStep,
  names: Set<string>
) {
  const expected = prefix(step.stages, step.stages.length),
    findings: Finding[] = []
  for (const [name, lines] of expected) {
    if (!names.has(name)) {
      findings.push({
        check: name,
        observed: 'Missing core table or view.',
        remedy: 'Apply the corresponding release-tagged schema change on a fenced restore.',
      })
      continue
    }
    const actual = logicalTable(await definition(connection, database, name))
    const required = logicalTable(lines)
    for (const line of required.filter((line) => !actual.includes(line)))
      findings.push({
        check: name,
        observed: `Missing definition: ${line}`,
        remedy: 'Restore this column, key, constraint or view from the tagged schema.',
      })
    for (const line of actual.filter((line) => !required.includes(line)))
      findings.push({
        check: name,
        observed: `Unexpected definition: ${line}`,
        remedy: 'Rehearse a scoped correction or restore before adoption.',
      })
  }
  for (const trigger of await rows(
    connection,
    'SELECT EVENT_OBJECT_TABLE AS subject,TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
  ))
    if (expected.has(trigger.subject) || trigger.subject === journal)
      findings.push({
        check: trigger.subject,
        observed: `Unexpected trigger ${trigger.name}`,
        remedy: 'Reconcile the trigger with the tagged contract on a fenced restore.',
      })
  return findings
}

export async function inspectOnConnection(
  connection: Connection,
  database: string,
  step: MysqlStep,
  deep = false,
  steps: MysqlStep[] = [step]
) {
  let serverVersion: string | undefined
  const report = (state: StorageStatus['state'], fields: Partial<StorageStatus> = {}) =>
    status(database, step, state, { serverVersion, target: steps.at(-1)!.version, ...fields })
  try {
    serverVersion = (await migrationSession(connection)).version
    const names = await inventory(connection)
    const hasJournal = names.has(journal)
    if (hasJournal) {
      try {
        assertDefinition(journal, step.journal, await definition(connection, database, journal))
      } catch (error) {
        if ((error as { code?: string }).code) throw error
        return report('corrupt', {
          findings: [
            { check: journal, observed: (error as Error).message, remedy: actions.corrupt },
          ],
        })
      }
      const history = await rows(
        connection,
        'SELECT * FROM byline_core_migrations ORDER BY version'
      )
      const first = history[0]
      if (first) {
        try {
          validateHistory(history, steps)
        } catch (error) {
          return report('corrupt', {
            inspection: 'journal',
            findings: [
              { check: 'baseline', observed: (error as Error).message, remedy: actions.corrupt },
            ],
          })
        }
        const last = history.at(-1)!
        if (last.version > steps.at(-1)!.version)
          return report('newer', { inspection: 'journal', observed: last.version })
        if (last.version > step.version && last.state === 'applying') {
          let observed = `Recorded stage ${last.stage} of version ${last.version}.`
          try {
            const { ahead } = await verifyUpgradePrefix(
              connection,
              database,
              steps,
              last.version,
              last.stage,
              true,
              first.origin === 'adopted'
            )
            if (ahead) observed += ' The next DDL is already present.'
          } catch (error) {
            observed += ` ${(error as Error).message}`
          }
          return report('interrupted', {
            inspection: 'journal',
            observed: history.at(-2)!.version,
            pending: steps.filter((s) => s.version >= last.version).map((s) => s.version),
            findings: [
              {
                check: 'upgrade-stage',
                observed,
                remedy:
                  'Fence writers and use supervised storage migrate after verifying or repairing this stage.',
              },
            ],
          })
        }
        if (first.state === 'applying') {
          let observed = `Recorded stage ${first.stage} of ${step.stages.length}.`
          try {
            const ahead = await verifyPrefix(
              connection,
              database,
              step,
              first.stage,
              names,
              true,
              true
            )
            if (ahead) observed += ` Stage ${first.stage + 1} DDL is already present.`
          } catch (error) {
            observed += ` ${(error as Error).message}`
          }
          return report('interrupted', {
            inspection: 'journal',
            installationId: first.installation_id,
            findings: [{ check: 'baseline-stage', observed, remedy: actions.interrupted }],
            next: 'Repeat dedicated setup with existing credentials after resolving any discrepancy.',
          })
        }
        if (deep && last.version === step.version) {
          await requireSchemaPrivileges(connection, database, ['SELECT', 'SHOW VIEW', 'TRIGGER'])
          const findings = await catalogEvidence(connection, database, step, names)
          if (findings.length) return report('partial', { findings })
        }
        const pending = steps.filter((s) => s.version > last.version).map((s) => s.version)
        return report(pending.length ? 'pending' : 'current', {
          pending,
          installationId: first.installation_id,
          observed: last.version,
          inspection: 'journal',
        })
      }
    }
    await requireSchemaPrivileges(connection, database, ['SELECT', 'SHOW VIEW', 'TRIGGER'])
    if (!step.stages.some((stage) => names.has(stage.object))) {
      return report(
        hasJournal ? 'interrupted' : names.size ? 'unrelated' : 'empty',
        hasJournal
          ? { next: 'Repeat dedicated setup to recheck the empty journal and target.' }
          : {}
      )
    }
    const findings = await catalogEvidence(connection, database, step, names)
    if (findings.length) return report('partial', { findings })
    const baseNames = new Set(step.stages.map((st) => st.object))
    for (const suffix of steps.slice(1))
      for (const stage of suffix.stages)
        if (!baseNames.has(stage.object) && names.has(stage.object))
          return report('partial', {
            findings: [
              {
                check: 'unjournaled-later-step',
                observed: stage.object,
                remedy: 'Restore the verified checkpoint before adopting.',
              },
            ],
          })
    const data = await dataFindings(connection)
    return report(data.length ? 'partial' : 'recognized', {
      inspection: 'catalog and content',
      findings: data,
      observed: data.length ? null : step.version,
    })
  } catch (error) {
    const message = (error as Error).message
    const state = message.includes('unsupported-engine') ? 'unsupported-engine' : 'inaccessible'
    return report(state, {
      findings: [{ check: 'catalog access', observed: message, remedy: actions[state] }],
    })
  }
}

export async function adoptOnConnection(
  connection: Connection,
  step: MysqlStep,
  steps: MysqlStep[] = [step]
) {
  const { database } = await migrationSession(connection)
  return withLock(connection, database, 5, async () => {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    let observed: StorageStatus
    try {
      observed = await inspectOnConnection(connection, database, step, true, steps)
    } finally {
      await connection.rollback()
    }
    if (observed.observed !== null && observed.observed > step.version)
      throw Error('This journal already has upgrades; use storage status.')

    if (observed.state === 'current' || observed.state === 'pending')
      return { adopted: false, version: step.version }
    if (observed.state !== 'recognized')
      throw new Error(
        `Cannot adopt: ${observed.state}. ${observed.findings.map((f) => `${f.check} ${f.observed}`).join('; ')} ${observed.next}`
      )
    await requireSchemaPrivileges(connection, database, [
      'SELECT',
      'SHOW VIEW',
      'TRIGGER',
      'CREATE',
      'INSERT',
    ])
    if (!(await inventory(connection)).has(journal)) await connection.query(createJournal)
    assertDefinition(journal, step.journal, await definition(connection, database, journal))
    await connection.query(
      `INSERT INTO byline_core_migrations
      (version,format_version,installation_id,origin,digest,state,classification,compatible_from,stage,recorded_by,completed_at)
      VALUES (?,1,?,'adopted',?,'applied',?,?,?,CURRENT_USER(),UTC_TIMESTAMP(6))`,
      [
        step.version,
        randomUUID(),
        step.sha256,
        step.classification,
        step.compatible_from,
        step.stages.length,
      ]
    )
    return { adopted: true, version: step.version }
  })
}
