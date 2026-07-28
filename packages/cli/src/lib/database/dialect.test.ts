import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../../test-helpers.js'
import { inspectDbDialect, isDbDialect, resolveDbDialect } from './dialect.js'
import type { Context } from '../../context.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe('database dialect selection', () => {
  it.each([
    ['postgres', true],
    ['mysql', true],
    ['sqlite', false],
    ['', false],
    [true, false],
  ])('classifies %j as a supported dialect=%s', (value, supported) => {
    expect(isDbDialect(value)).toBe(supported)
  })

  it('persists a command-line selection into fresh state', async () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    ctx.cliFlags.database = 'mysql'

    expect(await resolveDbDialect(ctx)).toBe('mysql')
    expect(ctx.state.get().answers.dbDialect).toBe('mysql')
  })

  it('prompts for a fresh state and uses PostgreSQL as the first/default choice', async () => {
    const ctx = createTestContext()
    contexts.push(ctx)

    expect(await resolveDbDialect(ctx)).toBe('postgres')
    expect(ctx.state.get().answers.dbDialect).toBe('postgres')
  })

  it('reuses the persisted dialect when the matching flag is supplied', async () => {
    const ctx = createTestContext({ dbDialect: 'mysql' })
    contexts.push(ctx)
    ctx.cliFlags.database = 'mysql'

    expect(inspectDbDialect(ctx)).toEqual({ state: 'resolved', dialect: 'mysql' })
    expect(await resolveDbDialect(ctx)).toBe('mysql')
  })

  it('blocks a conflicting flag without changing persisted state', async () => {
    const ctx = createTestContext({ dbDialect: 'postgres' })
    contexts.push(ctx)
    ctx.cliFlags.database = 'mysql'

    expect(inspectDbDialect(ctx)).toMatchObject({ state: 'blocked' })
    expect(await resolveDbDialect(ctx)).toBeNull()
    expect(ctx.state.get().answers.dbDialect).toBe('postgres')
  })

  it('blocks an invalid value even when a caller bypasses CLI validation', () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    ctx.cliFlags.database = 'sqlite'

    expect(inspectDbDialect(ctx)).toMatchObject({
      state: 'blocked',
      reason: expect.stringContaining('sqlite'),
    })
  })
})
