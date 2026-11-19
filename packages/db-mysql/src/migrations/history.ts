import type { Connection, RowDataPacket } from 'mysql2/promise'

import { assertDefinition, definition, journal, rows } from './catalog.js'
import { validateBaselineRow } from './runner.js'
import type { MysqlStep } from './assets.js'

export function validateHistory(history: RowDataPacket[], steps: MysqlStep[]) {
  const first = history[0]
  if (!first) return
  validateBaselineRow(first, steps[0]!)
  for (let index = 1; index < history.length; index++) {
    const row = history[index]!,
      prev = history[index - 1]!,
      step = steps[index]
    if (
      prev.state !== 'applied' ||
      row.version !== prev.version + 1 ||
      row.installation_id !== first.installation_id ||
      row.format_version !== 1 ||
      row.origin !== 'migrated' ||
      !row.recorded_by ||
      !/^[a-f\d]{64}$/.test(row.digest) ||
      !Number.isInteger(row.stage) ||
      row.stage < 0 ||
      !Number.isInteger(row.compatible_from) ||
      !(row.classification === 'fenced'
        ? row.compatible_from === row.version
        : row.classification === 'online' &&
          row.compatible_from >= prev.compatible_from &&
          row.compatible_from < row.version) ||
      !(row.state === 'applied'
        ? row.completed_at != null && row.stage > 0
        : row.state === 'applying' && row.completed_at === null) ||
      (step &&
        (row.digest !== step.sha256 ||
          row.classification !== step.classification ||
          row.compatible_from !== step.compatible_from ||
          row.stage > step.stages.length ||
          (row.state === 'applied' && row.stage !== step.stages.length)))
    )
      throw Error(
        `Corrupt MySQL journal at version ${row.version}; verify installation, continuity, digest, floor and stage evidence.`
      )
  }
}

export async function readHistory(connection: Connection, database: string, steps: MysqlStep[]) {
  assertDefinition(journal, steps[0]!.journal, await definition(connection, database, journal))
  const history = await rows(connection, 'SELECT * FROM byline_core_migrations ORDER BY version')
  validateHistory(history, steps)
  return history
}
