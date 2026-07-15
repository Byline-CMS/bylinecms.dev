import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../test-helpers.js'
import { applyPlannedWrites } from './planned-writes.js'
import type { Context } from '../context.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe('planned writes', () => {
  it('applies no writes when an intermediate parent is a file', () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    const blocker = ctx.resolve('generated/blocked')
    mkdirSync(ctx.resolve('generated'), { recursive: true })
    writeFileSync(blocker, 'user-owned')

    const first = ctx.resolve('generated/first.ts')
    const result = applyPlannedWrites([
      { path: first, contents: 'first', mode: 'create' },
      { path: join(blocker, 'second.ts'), contents: 'second', mode: 'create' },
    ])

    expect(result.written).toEqual([])
    expect(result.conflicts).toContain(blocker)
    expect(existsSync(first)).toBe(false)
    expect(readFileSync(blocker, 'utf8')).toBe('user-owned')
  })

  it('rejects colliding planned file and descendant paths before writing', () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    const parent = ctx.resolve('generated/route')
    const result = applyPlannedWrites([
      { path: parent, contents: 'file', mode: 'create' },
      { path: join(parent, 'child.ts'), contents: 'child', mode: 'create' },
    ])

    expect(result.written).toEqual([])
    expect(existsSync(parent)).toBe(false)
  })

  it('does not follow an intermediate symlink outside the planned tree', () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    const outside = ctx.resolve('outside')
    const linked = ctx.resolve('generated/link')
    mkdirSync(outside)
    mkdirSync(ctx.resolve('generated'))
    symlinkSync(outside, linked)

    const result = applyPlannedWrites([
      { path: join(linked, 'escaped.ts'), contents: 'escaped', mode: 'create' },
    ])

    expect(result.written).toEqual([])
    expect(result.conflicts).toContain(linked)
    expect(existsSync(join(outside, 'escaped.ts'))).toBe(false)
  })

  it('rejects a dangling symlink at a final target before applying any writes', () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    const outside = ctx.resolve('outside')
    const target = ctx.resolve('generated/linked.ts')
    const escaped = join(outside, 'escaped.ts')
    mkdirSync(outside)
    mkdirSync(ctx.resolve('generated'))
    symlinkSync(escaped, target)

    const first = ctx.resolve('generated/first.ts')
    const result = applyPlannedWrites([
      { path: first, contents: 'first', mode: 'create' },
      { path: target, contents: 'escaped', mode: 'create' },
    ])

    expect(result.written).toEqual([])
    expect(result.conflicts).toContain(target)
    expect(existsSync(first)).toBe(false)
    expect(existsSync(escaped)).toBe(false)
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
  })
})
