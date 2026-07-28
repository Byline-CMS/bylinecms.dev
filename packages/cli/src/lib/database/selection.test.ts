import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../../test-helpers.js'
import { inspectDatabaseAdapter, isDatabaseAdapterId, resolveDatabaseAdapter } from './selection.js'
import type { Context } from '../../context.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe('database adapter selection', () => {
  it.each([
    ['postgres', true],
    ['mysql', true],
    ['sqlite', false],
    ['', false],
    [true, false],
  ])('classifies %j as a supported adapter=%s', (value, supported) => {
    expect(isDatabaseAdapterId(value)).toBe(supported)
  })

  it('persists a command-line selection into fresh state', async () => {
    const ctx = createTestContext({ dbAdapter: undefined })
    contexts.push(ctx)
    ctx.cliFlags.database = 'mysql'

    expect(await resolveDatabaseAdapter(ctx)).toBe('mysql')
    expect(ctx.state.get().answers.dbAdapter).toBe('mysql')
  })

  it('prompts for a fresh state and uses PostgreSQL as the first/default choice', async () => {
    const ctx = createTestContext({ dbAdapter: undefined })
    contexts.push(ctx)

    expect(await resolveDatabaseAdapter(ctx)).toBe('postgres')
    expect(ctx.state.get().answers.dbAdapter).toBe('postgres')
  })

  it('reuses the persisted adapter when the matching flag is supplied', async () => {
    const ctx = createTestContext({ dbAdapter: 'mysql' })
    contexts.push(ctx)
    ctx.cliFlags.database = 'mysql'

    expect(inspectDatabaseAdapter(ctx)).toEqual({ state: 'resolved', adapter: 'mysql' })
    expect(await resolveDatabaseAdapter(ctx)).toBe('mysql')
  })

  it('blocks a conflicting flag without changing persisted state', async () => {
    const ctx = createTestContext({ dbAdapter: 'postgres' })
    contexts.push(ctx)
    ctx.cliFlags.database = 'mysql'

    expect(inspectDatabaseAdapter(ctx)).toMatchObject({ state: 'blocked' })
    expect(await resolveDatabaseAdapter(ctx)).toBeNull()
    expect(ctx.state.get().answers.dbAdapter).toBe('postgres')
  })

  it('blocks an invalid value even when a caller bypasses CLI validation', () => {
    const ctx = createTestContext({ dbAdapter: undefined })
    contexts.push(ctx)
    ctx.cliFlags.database = 'sqlite'

    expect(inspectDatabaseAdapter(ctx)).toMatchObject({
      state: 'blocked',
      reason: expect.stringContaining('sqlite'),
    })
  })
})
