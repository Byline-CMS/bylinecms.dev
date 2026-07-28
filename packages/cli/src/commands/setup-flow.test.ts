import { rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { dependencySpecsFor } from '../manifest/deps.js'
import { dbPhase } from '../phases/db.js'
import { dbInitPhase } from '../phases/db-init.js'
import { runPhase } from '../runner.js'
import { createTestContext } from '../test-helpers.js'
import { collectDoctorRows } from './doctor.js'
import { runSetupFlow, type SetupFlowDependencies } from './setup.js'
import { runSetupChecks } from './setup-checks.js'
import type { Context } from '../context.js'
import type {
  DatabaseProvisionerRegistry,
  DbProvisioner,
  DbTargetInspection,
} from '../lib/database/provisioner.js'
import type { Prompter } from '../prompts.js'
import type { DatabaseAdapterId, Phase, PhaseId, PhaseState } from '../types.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe('setup flow ordering', () => {
  it.each([
    ['postgres', 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'],
    ['mysql', 'mysql://root:root@127.0.0.1:3306/mysql'],
  ] as const)(
    'selects %s in a fresh state before adapter-aware dependency and env checks',
    async (adapter, adminUrl) => {
      const events: string[] = []
      const verification = {
        async verifyAdminConnection() {
          events.push('db')
          return `${adapter} test version`
        },
      }
      const provisioners = provisionerRegistry(
        adapter === 'mysql' ? { mysql: verification } : { postgres: verification }
      )
      const ctx = createTestContext(
        { dbAdapter: undefined, examples: false },
        {
          cliFlags: { database: adapter },
          prompter: databasePrompter(adminUrl),
          provisioners,
        }
      )
      contexts.push(ctx)
      writeSetupContract(ctx, adapter)

      const result = await runSetupFlow(
        ctx,
        { noSeedAdmin: true, noSeedDocs: true },
        flowDependencies({
          preflightPhase: recordingPhase('preflight', events),
          dbPhase,
          dbInitPhase: recordingPhase('db-init', events),
          runChecks: async (checkContext) => {
            events.push('checks')
            return runSetupChecks(checkContext)
          },
        })
      )

      expect(result).toEqual({ state: 'done' })
      expect(ctx.state.get().answers.dbAdapter).toBe(adapter)
      expect(events).toEqual(['preflight', 'db', 'checks', 'db-init'])
    }
  )

  it.each(['blocked', 'pending'] as const)(
    'stops before either seed when database initialization is %s',
    async (dbInitState) => {
      const events: string[] = []
      const ctx = createTestContext({ dbAdapter: 'mysql' })
      contexts.push(ctx)

      const result = await runSetupFlow(
        ctx,
        {},
        flowDependencies({
          preflightPhase: recordingPhase('preflight', events),
          dbPhase: recordingPhase('db', events),
          dbInitPhase: recordingPhase('db-init', events, dbInitState),
          seedAdminPhase: recordingPhase('seed-admin', events),
          seedDocsPhase: recordingPhase('seed-docs', events),
          runChecks: async () => {
            events.push('checks')
            return 'proceed'
          },
        })
      )

      expect(result).toEqual({ state: 'halted', stage: 'db-init' })
      expect(events).toEqual(['preflight', 'db', 'checks', 'db-init'])
    }
  )

  it('skips a completed db-init normally but re-enters its occupied-target guard under force', async () => {
    const normalInspections: DbTargetInspection[] = []
    const normal = completedDatabaseContext(
      {},
      provisionerRegistry({
        mysql: {
          async inspectTarget() {
            const inspection = { exists: true, objects: ['byline_documents'] }
            normalInspections.push(inspection)
            return inspection
          },
        },
      })
    )
    contexts.push(normal)

    const normalResult = await runSetupFlow(
      normal,
      { noSeedAdmin: true, noSeedDocs: true },
      flowDependencies({
        dbPhase: recordingPhase('db', []),
        dbInitPhase,
      })
    )
    expect(normalResult).toEqual({ state: 'done' })
    expect(normalInspections).toEqual([])

    const forcedInspections: DbTargetInspection[] = []
    const forced = completedDatabaseContext(
      { force: true },
      provisionerRegistry({
        mysql: {
          async inspectTarget() {
            const inspection = { exists: true, objects: ['byline_documents'] }
            forcedInspections.push(inspection)
            return inspection
          },
        },
      })
    )
    contexts.push(forced)

    const forcedResult = await runSetupFlow(
      forced,
      { noSeedAdmin: true, noSeedDocs: true },
      flowDependencies({
        dbPhase: recordingPhase('db', []),
        dbInitPhase,
      })
    )
    expect(forcedResult).toEqual({ state: 'halted', stage: 'db-init' })
    expect(forcedInspections).toHaveLength(1)
    expect(forced.secrets.dbPassword).toBeUndefined()
  })
})

it('reports a fresh missing adapter as pending without prompting in doctor', async () => {
  const ctx = createTestContext(
    { dbAdapter: undefined },
    {
      prompter: {
        ...databasePrompter(''),
        async select(): Promise<never> {
          throw new Error('doctor must not prompt')
        },
      },
    }
  )
  contexts.push(ctx)

  expect(await collectDoctorRows(ctx, [dbPhase])).toEqual([
    { id: 'db', title: 'Database', state: 'pending' },
  ])
  expect(ctx.state.get().answers.dbAdapter).toBeUndefined()
})

function flowDependencies(overrides: Partial<SetupFlowDependencies> = {}): SetupFlowDependencies {
  return {
    runPhase,
    runChecks: async () => 'proceed',
    preflightPhase: noOpPhase('preflight'),
    dbPhase: noOpPhase('db'),
    dbInitPhase: noOpPhase('db-init'),
    seedAdminPhase: noOpPhase('seed-admin'),
    seedDocsPhase: noOpPhase('seed-docs'),
    ...overrides,
  }
}

function noOpPhase(id: PhaseId): Phase {
  return recordingPhase(id, [])
}

function recordingPhase(
  id: PhaseId,
  events: string[],
  result: Extract<PhaseState, 'done' | 'blocked' | 'pending'> = 'done'
): Phase {
  return {
    id,
    title: `${id} — test`,
    defaultMode: 'auto',
    async detect(ctx) {
      return ctx.state.isComplete(id) ? 'done' : 'pending'
    },
    async plan() {
      return { writes: [], commands: [], notes: [`run ${id}`] }
    },
    async apply() {
      events.push(id)
      return { state: result }
    },
  }
}

function completedDatabaseContext(
  cliFlags: Record<string, string | boolean | undefined>,
  provisioners: DatabaseProvisionerRegistry
): Context {
  const ctx = createTestContext(
    {
      dbAdapter: 'mysql',
      dbStrategy: 'existing',
      dbHost: '127.0.0.1',
      dbPort: 3306,
      dbName: 'byline_test',
      dbUser: 'byline',
    },
    { cliFlags, provisioners }
  )
  ctx.state.markPhaseComplete('preflight')
  ctx.state.markPhaseComplete('db')
  ctx.state.markPhaseComplete('db-init')
  ctx.secrets.adminUrl = 'mysql://root:root@127.0.0.1:3306/mysql'
  return ctx
}

function writeSetupContract(ctx: Context, adapter: DatabaseAdapterId): void {
  const dependencies = Object.fromEntries(
    dependencySpecsFor({ dbAdapter: adapter, examples: false })
      .filter((spec) => spec.group === 'byline')
      .map((spec) => [spec.name, spec.version])
  )
  writeFileSync(ctx.resolve('package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`)
  writeFileSync(ctx.resolve('.env'), 'VITE_SERVER_URL=http://localhost:5173/\n')
  const connectionKey =
    adapter === 'mysql'
      ? 'BYLINE_DB_MYSQL_CONNECTION_STRING'
      : 'BYLINE_DB_POSTGRES_CONNECTION_STRING'
  writeFileSync(
    ctx.resolve('.env.local'),
    [
      `${connectionKey}=configured`,
      'BYLINE_JWT_SECRET=configured',
      'BYLINE_SUPERADMIN_EMAIL=admin@example.test',
      'BYLINE_SUPERADMIN_PASSWORD=configured',
      '',
    ].join('\n')
  )
}

function databasePrompter(adminUrl: string): Prompter {
  const noop = () => {}
  return {
    async text({ message, defaultValue }) {
      if (message.includes('administrator connection URL')) return adminUrl
      if (message.includes('Database name')) return 'byline_test'
      if (message.includes('Application')) return 'byline'
      return defaultValue ?? ''
    },
    async password() {
      return 'password'
    },
    async select({ options }) {
      const existing = options.find((option) => option.value === 'existing')
      return (existing ?? options[0])?.value as never
    },
    async confirm() {
      return true
    },
    spinner: () => ({ start: noop, stop: noop }),
    intro: noop,
    outro: noop,
    note: noop,
    cancel(message): never {
      throw new Error(message)
    },
  }
}

function provisionerRegistry(
  overrides: Partial<Record<DatabaseAdapterId, Partial<DbProvisioner>>> = {}
): DatabaseProvisionerRegistry {
  const make = (adapter: DatabaseAdapterId): DbProvisioner => ({
    adapter,
    async verifyAdminConnection() {
      return `${adapter} test version`
    },
    async inspectTarget() {
      return { exists: false, objects: [] }
    },
    async provisionTarget() {},
    async applyBaseline() {},
    ...overrides[adapter],
  })
  return { postgres: make('postgres'), mysql: make('mysql') }
}
