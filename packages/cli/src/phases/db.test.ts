import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { dbPhase } from './db.js'
import type { Context } from '../context.js'
import type { DatabaseProvisionerRegistry, DbProvisioner } from '../lib/database/provisioner.js'
import type { DatabaseAdapterId } from '../types.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe.each([
  ['postgres', 'postgresql:'],
  ['mysql', 'mysql:'],
] as const)('%s database phase', (adapter, protocol) => {
  it('verifies through the selected provisioner and persists non-secret connection data', async () => {
    const verified: string[] = []
    const provisioners = fakeRegistry(adapter, {
      async verifyAdminConnection(url) {
        verified.push(url)
        return `${adapter} test version`
      },
    })
    const ctx = createTestContext({ dbAdapter: adapter }, { provisioners })
    contexts.push(ctx)

    expect((await dbPhase.apply(await dbPhase.plan(ctx), ctx)).state).toBe('done')
    expect(verified).toHaveLength(1)
    expect(verified[0]).toMatch(new RegExp(`^${protocol}`))
    expect(ctx.state.get().answers).toMatchObject({
      dbAdapter: adapter,
      dbHost: '127.0.0.1',
      dbName: 'byline',
      dbUser: 'byline',
    })
    expect(ctx.secrets.adminUrl).toBe(verified[0])
    expect(ctx.state.get().answers).not.toHaveProperty('adminUrl')
  })
})

it('rejects an administrator URL for the wrong adapter before connecting', async () => {
  let verificationCalls = 0
  const provisioners = fakeRegistry('mysql', {
    async verifyAdminConnection() {
      verificationCalls += 1
      return 'unexpected'
    },
  })
  const ctx = createTestContext({ dbAdapter: 'mysql' }, { provisioners })
  contexts.push(ctx)
  const defaultText = ctx.prompter.text.bind(ctx.prompter)
  ctx.prompter.text = async (options) =>
    options.message.includes('administrator connection URL')
      ? 'postgresql://postgres:secret@localhost/postgres'
      : defaultText(options)

  expect((await dbPhase.apply(await dbPhase.plan(ctx), ctx)).state).toBe('blocked')
  expect(verificationCalls).toBe(0)
})

function fakeRegistry(
  selected: DatabaseAdapterId,
  overrides: Partial<DbProvisioner>
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
    ...(adapter === selected ? overrides : {}),
  })
  return { postgres: make('postgres'), mysql: make('mysql') }
}
