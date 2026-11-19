import { Client } from 'pg'

import { loadStorageSteps } from './assets.js'
import { readStatus, storageStatus } from './inspect.js'
import {
  adoptOnConnection,
  migrateOnConnection,
  onlineOnConnection,
  type ReleasePlan,
} from './operations.js'
import { installOnConnection } from './runner.js'

/** Verify release assets before provisioning a dedicated database or role. */
export function verifyStorageMigrations(): void {
  loadStorageSteps()
}

async function onTarget<T>(
  connectionString: string,
  run: (client: Client, database: string, steps: ReturnType<typeof loadStorageSteps>) => Promise<T>
) {
  const steps = loadStorageSteps()
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const database = decodeURIComponent(new URL(connectionString).pathname.slice(1))
    const target = await client.query('SELECT pg_catalog.current_database() AS name')
    if (!database || database !== target.rows[0]?.name)
      throw new Error('Connected PostgreSQL database differs from the requested target')
    return await run(client, database, steps)
  } finally {
    await client.end()
  }
}

/** Install or verify core storage on a direct connection to the target database. */
export function installCoreStorage(connectionString: string) {
  return onTarget(connectionString, (client, _database, steps) =>
    installOnConnection(client, steps)
  )
}

/** Adopt only the supported native checkpoint while every writer is fenced. */
export function adoptCoreStorage(connectionString: string) {
  return onTarget(connectionString, adoptOnConnection)
}

/** Apply pending steps to an installed or adopted database with writers fenced. */
export function migrateCoreStorage(connectionString: string) {
  return onTarget(connectionString, migrateOnConnection)
}

export type { StorageStatus } from './inspect.js'

/** Inspect a single consistent snapshot without writing to the target. */
export async function inspectCoreStorage(connectionString: string) {
  const steps = loadStorageSteps()
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1))
  const client = new Client({ connectionString })
  try {
    try {
      await client.connect()
    } catch {
      return storageStatus(database, steps, 'inaccessible', {
        findings: [
          {
            check: 'connection',
            observed: 'Could not connect to the requested PostgreSQL database.',
            remedy: 'Check CONNECT access, credentials and endpoint.',
          },
        ],
      })
    }
    return await readStatus(client, database, steps)
  } finally {
    await client.end()
  }
}

/** Run the target release's eligible migrations on its paired direct endpoint. */
export function migrateCoreStorageOnline(options: {
  directUrl: string
  runtimeUrl: string
  deployedReleases: readonly string[]
  report?: (plan: ReleasePlan) => void
}) {
  return onTarget(options.directUrl, (direct, database, steps) =>
    onTarget(options.runtimeUrl, (runtime, runtimeDatabase) =>
      onlineOnConnection(
        direct,
        database,
        runtime,
        runtimeDatabase,
        steps,
        options.deployedReleases,
        options.report
      )
    )
  )
}
