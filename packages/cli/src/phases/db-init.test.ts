import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { dbInitPhase } from './db-init.js'
import type { Context } from '../context.js'
import type {
  BaselineArgs,
  DatabaseProvisionerRegistry,
  DbProvisioner,
  ProvisionArgs,
} from '../lib/database/provisioner.js'
import type { DatabaseAdapterId } from '../types.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe.each([
  ['postgres', 5432, 'postgresql:'],
  ['mysql', 3306, 'mysql:'],
] as const)('%s db-init provisioner dispatch', (adapter, port, protocol) => {
  it('provisions and applies the selected bundled baseline through the seam', async () => {
    const calls: Array<
      { type: 'provision'; args: ProvisionArgs } | { type: 'baseline'; args: BaselineArgs }
    > = []
    const provisioners = recordingRegistry(adapter, calls)
    const ctx = createTestContext(
      {
        dbAdapter: adapter,
        dbHost: '127.0.0.1',
        dbPort: port,
        dbName: 'byline',
        dbUser: 'byline',
      },
      { provisioners }
    )
    contexts.push(ctx)
    ctx.secrets.adminUrl = `${protocol}//admin:secret@127.0.0.1:${port}/${adapter === 'postgres' ? 'postgres' : 'mysql'}`
    ctx.secrets.dbPassword = 'application-password'

    expect((await dbInitPhase.apply(await dbInitPhase.plan(ctx), ctx)).state).toBe('done')
    expect(calls.map((call) => call.type)).toEqual(['provision', 'baseline'])
    const baseline = calls[1]
    expect(baseline?.type).toBe('baseline')
    if (baseline?.type === 'baseline') {
      expect(baseline.args.applicationUrl).toMatch(new RegExp(`^${protocol}`))
      expect(baseline.args.migrationsFolder).toMatch(new RegExp(`/migrations/${adapter}$`))
    }
  })
})

function recordingRegistry(
  selected: DatabaseAdapterId,
  calls: Array<
    { type: 'provision'; args: ProvisionArgs } | { type: 'baseline'; args: BaselineArgs }
  >
): DatabaseProvisionerRegistry {
  const make = (adapter: DatabaseAdapterId): DbProvisioner => ({
    adapter,
    async verifyAdminConnection() {
      return `${adapter} test version`
    },
    async inspectTarget() {
      return { exists: false, objects: [] }
    },
    async provisionTarget(args) {
      if (adapter === selected) calls.push({ type: 'provision', args })
    },
    async applyBaseline(args) {
      if (adapter === selected) calls.push({ type: 'baseline', args })
    },
  })
  return { postgres: make('postgres'), mysql: make('mysql') }
}
