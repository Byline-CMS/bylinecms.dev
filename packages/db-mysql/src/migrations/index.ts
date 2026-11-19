import { createConnection } from 'mysql2/promise'

import { loadBaseline } from './assets.js'
import { assertDefinition, definition, journal, rows } from './catalog.js'
import { installOnConnection, migrationSession, validateBaselineRow } from './runner.js'

export function verifyStorageMigrations() {
  loadBaseline()
}

export async function installCoreStorage(
  connectionString: string,
  options?: { resumeOnly?: boolean }
) {
  const baseline = loadBaseline()
  const connection = await createConnection(connectionString)
  try {
    return await installOnConnection(connection, baseline, options)
  } finally {
    await connection.end()
  }
}

/** Read-only hint for dedicated setup. The installer repeats all checks under its lock. */
export async function hasInterruptedInstall(connectionString: string) {
  const step = loadBaseline()
  const connection = await createConnection(connectionString)
  try {
    const database = await migrationSession(connection)
    assertDefinition(journal, step.journal, await definition(connection, database, journal))
    const history = await rows(connection, 'SELECT * FROM byline_core_migrations ORDER BY version')
    if (!history.length) return true
    if (history.length !== 1) return false
    const row = history[0]!
    validateBaselineRow(row, step)
    return row.origin === 'installed' && row.state === 'applying'
  } finally {
    await connection.end()
  }
}

export { assertMigrationServer } from './runner.js'
