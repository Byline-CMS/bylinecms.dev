import { randomUUID } from 'node:crypto'

import type { Client } from 'pg'

import { validatePolicy } from './assets.js'
import { inspectOnConnection, readStatus, type StorageStatus } from './inspect.js'
import {
  acquireCoreLock,
  applyStorageSteps,
  checkSession,
  commitStep,
  createJournal,
  readJournal,
  recordStep,
  requireCoreLock,
} from './runner.js'
import type { StorageStep } from './assets.js'

function refuse(status: StorageStatus): never {
  const finding = status.findings[0]
  throw new Error(
    `PostgreSQL ${status.database}: ${status.state}. ${status.next} ${finding ? [finding.check, finding.observed, finding.remedy].join(' — ') : ''}`.trim()
  )
}

export async function adoptOnConnection(client: Client, database: string, steps: StorageStep[]) {
  await acquireCoreLock(client)
  // Take the consistent snapshot after lock acquisition. Writers and host DDL are fenced by the operator.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  try {
    const status = await inspectOnConnection(client, database, steps, true)
    if (status.state !== 'recognized') refuse(status)
    const history = await readJournal(client, steps)
    if (history.length) {
      await client.query('ROLLBACK')
      return { adopted: false, version: history[0]!.version }
    }
    await client.query('SET LOCAL search_path TO public')
    await checkSession(client)
    const baseline = steps[0]!
    await createJournal(client)
    await recordStep(client, baseline, randomUUID(), 'adopted')
    await commitStep(client, baseline.version)
    return { adopted: true, version: baseline.version }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

export async function migrateOnConnection(client: Client, database: string, steps: StorageStep[]) {
  await acquireCoreLock(client)
  const status = await readStatus(client, database, steps)
  if (status.state !== 'pending' && status.state !== 'current') refuse(status)
  await checkSession(client)
  const history = await readJournal(client, steps)
  return applyStorageSteps(client, steps, history)
}

export interface ReleasePlan {
  database: string
  target: number
  deployedReleases: readonly string[]
  pending: Array<{ version: number; classification: 'fenced' | 'online'; testedReleases: string[] }>
}

export async function onlineOnConnection(
  client: Client,
  database: string,
  runtime: Client,
  runtimeDatabase: string,
  steps: StorageStep[],
  deployedReleases: readonly string[],
  report?: (plan: ReleasePlan) => void
) {
  if (database !== runtimeDatabase)
    throw new Error('Direct and runtime database names differ. Check the deployment endpoint pair.')
  await acquireCoreLock(client)
  const direct = await readStatus(client, database, steps, true)
  if (direct.state !== 'pending' && direct.state !== 'current') refuse(direct)
  const app = await readStatus(runtime, runtimeDatabase, steps, true)
  if (app.state !== 'pending' && app.state !== 'current') refuse(app)
  if (
    !app.installationId ||
    app.installationId !== direct.installationId ||
    app.observed !== direct.observed
  )
    throw new Error(
      'Direct and runtime installation identifiers or journal versions differ. Check the deployment endpoint pair.'
    )
  await requireCoreLock(client)
  const history = await readJournal(client, steps)
  const pending = steps.slice(history.length)
  const plan: ReleasePlan = {
    database,
    target: direct.target,
    deployedReleases,
    pending: pending.map((s) => ({
      version: s.version,
      classification: s.classification,
      testedReleases: Object.keys(s.online?.tested_releases ?? {}),
    })),
  }
  report?.(plan)
  const deployedContracts = new Map<string, number>()
  for (const [i, step] of pending.entries()) {
    if (
      step.classification !== 'online' ||
      !validatePolicy(step, steps[history.length + i - 1]!.compatible_from)
    )
      throw new Error(
        `Blocked step ${step.version}: fenced or missing compatibility evidence. Stop promotion and use supervised migration with all writers fenced.`
      )
    if (!deployedReleases.length)
      throw new Error(
        `Blocked step ${step.version}: supply the deployed adapter versions from the active writer and worker inventory.`
      )
    for (const release of deployedReleases) {
      const contract = step.online?.tested_releases[release]
      if (
        typeof contract !== 'number' ||
        contract > direct.observed! ||
        (deployedContracts.has(release) && deployedContracts.get(release) !== contract)
      )
        throw new Error(
          `Blocked step ${step.version}: deployed adapter ${release} has no consistent compatibility evidence. Stop promotion.`
        )
      deployedContracts.set(release, contract)
    }
  }
  await checkSession(client)
  try {
    return await applyStorageSteps(client, steps, history)
  } catch (cause) {
    throw new Error(
      `Release migration stopped. Earlier steps may have committed. Stop promotion and run byline storage status. ${cause instanceof Error ? cause.message : 'PostgreSQL migration failed'}`,
      { cause }
    )
  }
}
