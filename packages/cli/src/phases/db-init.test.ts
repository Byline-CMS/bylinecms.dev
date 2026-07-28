import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { CLI_PACKAGE_VERSION } from '../lib/release-policy.js'
import { createTestContext } from '../test-helpers.js'
import { dbInitPhase, nativeSqlUpgradeUrl } from './db-init.js'
import type { Context } from '../context.js'
import type {
  BaselineArgs,
  DatabaseProvisionerRegistry,
  DbProvisioner,
  DbTargetInspection,
  ProvisionArgs,
} from '../lib/database/provisioner.js'
import type { DatabaseAdapterId } from '../types.js'
import type { Logger } from '../ui/logger.js'

type RecordedCall =
  | { type: 'inspect'; adminUrl: string; database: string }
  | { type: 'provision'; args: ProvisionArgs }
  | { type: 'baseline'; args: BaselineArgs }

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe.each([
  ['postgres', 5432, 'postgresql:'],
  ['mysql', 3306, 'mysql:'],
] as const)('%s guarded baseline dispatch', (adapter, port, protocol) => {
  it.each([
    ['missing', { exists: false, objects: [] }],
    ['empty', { exists: true, objects: [] }],
  ] as const)('allows a %s target', async (_label, inspection) => {
    const { ctx, calls } = testContext(
      adapter,
      { exists: inspection.exists, objects: [...inspection.objects] },
      { port }
    )
    ctx.secrets.dbPassword = 'application-password'

    expect((await dbInitPhase.apply(await dbInitPhase.plan(ctx), ctx)).state).toBe('done')
    expect(calls.map((call) => call.type)).toEqual(['inspect', 'provision', 'baseline'])

    const baseline = calls[2]
    expect(baseline?.type).toBe('baseline')
    if (baseline?.type === 'baseline') {
      expect(baseline.args.applicationUrl).toMatch(new RegExp(`^${protocol}`))
      expect(new URL(baseline.args.applicationUrl).hostname).toBe('admin-tunnel.test')
      expect(baseline.args.migrationsFolder).toMatch(new RegExp(`/migrations/${adapter}$`))
    }
  })

  it('refuses an existing Byline schema before credentials or mutation', async () => {
    const messages: string[] = []
    const { ctx, calls } = testContext(
      adapter,
      { exists: true, objects: ['BYLINE_DOCUMENTS', 'posts'] },
      { port, logger: capturingLogger(messages) }
    )

    expect((await dbInitPhase.apply(await dbInitPhase.plan(ctx), ctx)).state).toBe('blocked')
    expect(calls.map((call) => call.type)).toEqual(['inspect'])
    expect(ctx.secrets.dbPassword).toBeUndefined()
    expect(messages.join('\n')).toContain('target release')
    expect(messages.join('\n')).toContain(nativeSqlUpgradeUrl(adapter))
  })

  it('uses registry prerequisites in the plan', async () => {
    const { ctx } = testContext(adapter, { exists: false, objects: [] }, { port })
    const notes = (await dbInitPhase.plan(ctx)).notes.join('\n')

    expect(notes.includes('pgcrypto')).toBe(adapter === 'postgres')
  })

  it('reset skips inspection and dispatches destructive provisioning', async () => {
    const { ctx, calls } = testContext(
      adapter,
      { exists: true, objects: ['posts'] },
      { port, reset: true }
    )
    ctx.secrets.dbPassword = 'application-password'

    expect((await dbInitPhase.apply(await dbInitPhase.plan(ctx), ctx)).state).toBe('done')
    expect(calls.map((call) => call.type)).toEqual(['provision', 'baseline'])
    const provision = calls[0]
    expect(provision?.type).toBe('provision')
    if (provision?.type === 'provision') expect(provision.args.reset).toBe(true)
  })
})

it('refuses an unrelated occupied schema even when --force is present', async () => {
  const { ctx, calls } = testContext(
    'mysql',
    { exists: true, objects: ['posts', '__drizzle_migrations'] },
    { port: 3306, force: true }
  )

  expect((await dbInitPhase.apply(await dbInitPhase.plan(ctx), ctx)).state).toBe('blocked')
  expect(calls.map((call) => call.type)).toEqual(['inspect'])
  expect(ctx.secrets.dbPassword).toBeUndefined()
})

it('requires reset confirmation before inspection or mutation', async () => {
  const { ctx, calls } = testContext(
    'postgres',
    { exists: true, objects: ['posts'] },
    { port: 5432, reset: true, confirmed: false }
  )

  expect((await dbInitPhase.apply(await dbInitPhase.plan(ctx), ctx)).state).toBe('blocked')
  expect(calls).toEqual([])
})

it('builds a tag-pinned, adapter-correct native SQL upgrade URL', () => {
  expect(nativeSqlUpgradeUrl('postgres')).toBe(
    `https://github.com/Byline-CMS/bylinecms.dev/blob/v${CLI_PACKAGE_VERSION}/packages/db-postgres/sql/README.md`
  )
  expect(nativeSqlUpgradeUrl('mysql')).toBe(
    `https://github.com/Byline-CMS/bylinecms.dev/blob/v${CLI_PACKAGE_VERSION}/packages/db-mysql/sql/README.md`
  )
})

function testContext(
  adapter: DatabaseAdapterId,
  inspection: DbTargetInspection,
  options: {
    port: number
    reset?: boolean
    confirmed?: boolean
    force?: boolean
    logger?: Logger
  }
): { ctx: Context; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const provisioners = recordingRegistry(adapter, inspection, calls)
  const ctx = createTestContext(
    {
      dbAdapter: adapter,
      dbHost: 'application-service.test',
      dbPort: options.port,
      dbName: 'byline',
      dbUser: 'byline',
    },
    {
      provisioners,
      reset: options.reset,
      resetConfirmed: options.confirmed ?? options.reset,
      cliFlags: options.force ? { force: true } : {},
      logger: options.logger,
    }
  )
  contexts.push(ctx)
  const protocol = adapter === 'postgres' ? 'postgresql' : 'mysql'
  const adminDatabase = adapter === 'postgres' ? 'postgres' : 'mysql'
  ctx.secrets.adminUrl = `${protocol}://admin:secret@admin-tunnel.test:${options.port}/${adminDatabase}`
  return { ctx, calls }
}

function recordingRegistry(
  selected: DatabaseAdapterId,
  inspection: DbTargetInspection,
  calls: RecordedCall[]
): DatabaseProvisionerRegistry {
  const make = (adapter: DatabaseAdapterId): DbProvisioner => ({
    adapter,
    async verifyAdminConnection() {
      return `${adapter} test version`
    },
    async inspectTarget(adminUrl, database) {
      if (adapter === selected) calls.push({ type: 'inspect', adminUrl, database })
      return inspection
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

function capturingLogger(messages: string[]): Logger {
  const capture = (message: string) => messages.push(message)
  return {
    info: capture,
    warn: capture,
    error: capture,
    success: capture,
    step: capture,
    raw: capture,
  }
}
