import { type Connection, createConnection } from 'mysql2/promise'

import { loadBaseline, loadSteps } from './assets.js'
import { assertDefinition, definition, journal, rows } from './catalog.js'
import { readHistory } from './history.js'
import { adoptOnConnection, inspectOnConnection, status } from './inspect.js'
import { migrateOnConnection, type ReleasePlan, verifyUpgradePrefix } from './operations.js'
import {
  installOnConnection,
  inventory,
  migrationSession,
  validateBaselineRow,
  withLock,
} from './runner.js'

export function verifyStorageMigrations() {
  loadSteps()
}

export async function installCoreStorage(
  connectionString: string,
  options?: { resumeOnly?: boolean }
) {
  const steps = loadSteps(),
    baseline = steps[0]!
  const connection = await createConnection(connectionString)
  try {
    if (steps.length === 1) return await installOnConnection(connection, baseline, options)
    const { database } = await migrationSession(connection, true)
    return await withLock(connection, database, 5, async () => {
      const history = (await inventory(connection)).has(journal)
        ? await readHistory(connection, database, steps)
        : []
      if (options?.resumeOnly && history[0]?.state === 'applied')
        throw Error('Dedicated installation already completed its baseline; use storage migrate.')
      let changed = false
      if (history.length < 2)
        changed = (await installOnConnection(connection, baseline, options)).changed
      const result = await migrateOnConnection(connection, steps)
      const target = steps.at(-1)!
      await verifyUpgradePrefix(
        connection,
        database,
        steps,
        target.version,
        target.stages.length,
        false,
        history[0]?.origin === 'adopted'
      )
      return { database, version: target.version, changed: changed || result.applied.length > 0 }
    })
  } finally {
    await connection.end()
  }
}

/** Read-only hint for dedicated setup. The installer repeats all checks under its lock. */
export async function hasInterruptedInstall(connectionString: string) {
  const step = loadBaseline()
  const connection = await createConnection(connectionString)
  try {
    const { database } = await migrationSession(connection)
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

export { verifyCatalogFormat } from './format.js'
export type { StorageStatus } from './inspect.js'

export async function inspectCoreStorage(connectionString: string) {
  const steps = loadSteps(),
    step = steps[0]!
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1))
  let connection: Connection
  try {
    connection = await createConnection(connectionString)
  } catch {
    return status(database, step, 'inaccessible', {
      findings: [
        {
          check: 'connection',
          observed: 'Could not connect to the selected MySQL database.',
          remedy: 'Verify endpoint, credentials and database access.',
        },
      ],
    })
  }
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION READ ONLY')
    return await inspectOnConnection(connection, database, step, false, steps)
  } finally {
    await connection.end()
  }
}

export async function adoptCoreStorage(connectionString: string) {
  const steps = loadSteps(),
    step = steps[0]!
  const connection = await createConnection(connectionString)
  try {
    return await adoptOnConnection(connection, step, steps)
  } finally {
    await connection.end()
  }
}

export async function migrateCoreStorage(connectionString: string) {
  const steps = loadSteps(),
    connection = await createConnection(connectionString)
  try {
    return await migrateOnConnection(connection, steps)
  } finally {
    await connection.end()
  }
}

export async function migrateCoreStorageOnline(options: {
  directUrl: string
  runtimeUrl: string
  deployedReleases: readonly string[]
  report?: (plan: ReleasePlan) => void
}) {
  const steps = loadSteps(),
    direct = await createConnection(options.directUrl)
  try {
    const runtime = await createConnection(options.runtimeUrl)
    try {
      const control = await createConnection(options.directUrl)
      try {
        return await migrateOnConnection(direct, steps, { ...options, runtime, control })
      } finally {
        await control.end()
      }
    } finally {
      await runtime.end()
    }
  } finally {
    await direct.end()
  }
}
