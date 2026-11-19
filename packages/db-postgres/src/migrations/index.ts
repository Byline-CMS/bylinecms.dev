import { Client } from 'pg'

import { loadStorageSteps } from './assets.js'
import { installOnConnection } from './runner.js'

/** Verify release assets before provisioning a dedicated database or role. */
export function verifyStorageMigrations(): void {
  loadStorageSteps()
}

/** Install or verify core storage on a direct connection to the target database. */
export async function installCoreStorage(connectionString: string): Promise<{ applied: number[] }> {
  const steps = loadStorageSteps()
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const target = await client.query('SELECT current_database() AS name')
    const expected = decodeURIComponent(new URL(connectionString).pathname.slice(1))
    if (!expected || target.rows[0].name !== expected)
      throw new Error('Connected PostgreSQL database differs from the requested target')
    return await installOnConnection(client, steps)
  } finally {
    await client.end()
  }
}
