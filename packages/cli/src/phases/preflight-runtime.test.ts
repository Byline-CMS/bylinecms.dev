import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { preflightPhase } from './preflight.js'

const originalNode = Object.getOwnPropertyDescriptor(process.versions, 'node')!
const roots: string[] = []

afterEach(() => {
  Object.defineProperty(process.versions, 'node', originalNode)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function context(version: string) {
  Object.defineProperty(process.versions, 'node', { ...originalNode, value: version })
  const ctx = createTestContext({ pm: 'pnpm' })
  roots.push(ctx.cwd)
  mkdirSync(ctx.resolve('.git'))
  writeFileSync(ctx.resolve('package.json'), '{"name":"runtime-fixture"}\n')
  return ctx
}

describe('CLI minimum Node runtime', () => {
  it.each([
    '18.20.2',
    '20.9.0',
    '20.20.0',
    '21.7.3',
    '22.0.0',
    '22.11.9',
    '22.12.0',
    '22.22.0',
    '22.22.1',
  ])('blocks Node %s before installation work', async (version) => {
    const ctx = context(version)
    const error = vi.spyOn(ctx.logger, 'error')
    expect(await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).toEqual({
      state: 'blocked',
    })
    expect(error).toHaveBeenCalledWith(`Node 22.22.2+ required (found ${version})`)
    error.mockRestore()
  })

  it.each(['22.22.2', '22.23.0', '24.18.0'])('accepts Node %s', async (version) => {
    const ctx = context(version)
    expect(await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).toEqual({
      state: 'done',
    })
  })

  it('rechecks a previously completed preflight after a runtime downgrade', async () => {
    const ctx = context('22.22.1')
    ctx.state.markPhaseComplete('preflight')
    expect(await preflightPhase.detect(ctx)).toBe('pending')
    expect((await preflightPhase.apply(await preflightPhase.plan(ctx), ctx)).state).toBe('blocked')
  })
})
