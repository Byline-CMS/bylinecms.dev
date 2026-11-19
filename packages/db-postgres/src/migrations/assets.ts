import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

export interface StorageStep {
  version: number
  name: string
  sha256: string
  classification: 'fenced' | 'online'
  compatible_from: number
  relations: Record<string, string[]>
  online?: {
    tested_releases: Record<string, number>
    evidence: string
    lock_timeout_ms: number
    statement_timeout_ms: number
  }
  sql: string
}

const directory = new URL('../../migrations/', import.meta.url)

// The release manifest must account for each schema contract it admits. Eligibility
// for a deployed release is an exact lookup, without ranges or transitive inference.
export function validatePolicy(step: StorageStep, previousFloor: number) {
  if (step.classification === 'fenced')
    return step.compatible_from === step.version && step.online === undefined
  const proof = step.online
  if (
    step.classification !== 'online' ||
    !proof ||
    !Number.isInteger(step.compatible_from) ||
    step.compatible_from < previousFloor ||
    step.compatible_from >= step.version ||
    typeof proof.evidence !== 'string' ||
    !proof.evidence.trim() ||
    !proof.tested_releases ||
    [proof.lock_timeout_ms, proof.statement_timeout_ms].some(
      (ms) => !Number.isSafeInteger(ms) || ms <= 0 || ms > 2147483647
    )
  )
    return false
  const contracts = new Set<number>()
  for (const [release, contract] of Object.entries(proof.tested_releases)) {
    if (
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(release) ||
      !Number.isInteger(contract) ||
      contract < step.compatible_from ||
      contract > step.version
    )
      return false
    contracts.add(contract)
  }
  for (let v = step.compatible_from; v < step.version; v++) if (!contracts.has(v)) return false
  return true
}

// Release SQL runs inside the transaction that records its receipt. Reject
// session/ownership control before provisioning or sending any SQL to PostgreSQL.
export function validateRunnerSql(sql: string) {
  const statements = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  if (
    !statements.trim() ||
    /byline:ownership-guard/i.test(sql) ||
    /(?:^|;)\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION|GRANT|REVOKE|VACUUM|ALTER\s+SYSTEM|(?:CREATE|DROP)\s+(?:DATABASE|TABLESPACE))\b/i.test(
      statements
    ) ||
    /\b(?:OWNER\s+TO|REASSIGN\s+OWNED|CONCURRENTLY)\b/i.test(statements) ||
    /^\s*\\/m.test(statements)
  )
    throw Error('PostgreSQL runner SQL must preserve transaction and ownership control')
}

export function loadStorageSteps(): StorageStep[] {
  const files = readdirSync(directory).sort()
  const manifests = files.filter((file) => /^\d{4}_[a-z0-9_]+\.json$/.test(file))
  if (!manifests.length || files.length !== manifests.length * 2) {
    throw new Error('Invalid PostgreSQL storage migration asset inventory')
  }
  let previousFloor = 15
  return manifests.map((file, index) => {
    const entry = JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as StorageStep
    const sql = readFileSync(new URL(file.replace(/\.json$/, '.sql'), directory))
    if (
      entry.version !== 15 + index ||
      file !== `${String(entry.version).padStart(4, '0')}_${entry.name}.json` ||
      createHash('sha256').update(sql).digest('hex') !== entry.sha256 ||
      !validatePolicy(entry, previousFloor) ||
      !entry.relations ||
      !Object.values(entry.relations).every(
        (names) => Array.isArray(names) && names.every((name) => typeof name === 'string')
      )
    )
      throw new Error(`Invalid PostgreSQL storage migration ${file}`)
    validateRunnerSql(sql.toString('utf8'))
    previousFloor = entry.compatible_from
    return { ...entry, sql: sql.toString('utf8') }
  })
}
