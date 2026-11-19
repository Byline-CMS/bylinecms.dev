import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

export interface StorageStep {
  version: number
  name: string
  sha256: string
  classification: 'fenced' | 'online'
  compatible_from: number
  relations: Record<string, string[]>
  sql: string
}

const directory = new URL('../../migrations/', import.meta.url)

export function loadStorageSteps(): StorageStep[] {
  const files = readdirSync(directory).sort()
  const manifests = files.filter((file) => /^\d{4}_[a-z0-9_]+\.json$/.test(file))
  if (!manifests.length || files.length !== manifests.length * 2) {
    throw new Error('Invalid PostgreSQL storage migration asset inventory')
  }
  return manifests.map((file, index) => {
    const entry = JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as StorageStep
    const sql = readFileSync(new URL(file.replace(/\.json$/, '.sql'), directory))
    if (
      entry.version !== 15 + index ||
      file !== `${String(entry.version).padStart(4, '0')}_${entry.name}.json` ||
      createHash('sha256').update(sql).digest('hex') !== entry.sha256 ||
      entry.classification !== 'fenced' ||
      entry.compatible_from !== entry.version ||
      !entry.relations ||
      !Object.values(entry.relations).every(
        (names) => Array.isArray(names) && names.every((name) => typeof name === 'string')
      )
    )
      throw new Error(`Invalid PostgreSQL storage migration ${file}`)
    return { ...entry, sql: sql.toString('utf8') }
  })
}
