import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureGenerationScripts } from './scaffold.js'
import type { Context } from '../context.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('ensureGenerationScripts', () => {
  it('adds generation commands without replacing an existing script', () => {
    const directory = mkdtempSync(join(tmpdir(), 'byline-scaffold-'))
    temporaryDirectories.push(directory)
    writeFileSync(
      join(directory, 'package.json'),
      `${JSON.stringify({ scripts: { 'byline:generate': 'custom-generator' } }, null, 2)}\n`,
      'utf8'
    )
    const ctx = {
      resolve: (...parts: string[]) => resolve(directory, ...parts),
    } as Context

    expect(ensureGenerationScripts(ctx)).toEqual(['byline:generate:check'])
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts).toEqual({
      'byline:generate': 'custom-generator',
      'byline:generate:check': 'tsx byline/scripts/generate-types.ts --check',
    })
    expect(ensureGenerationScripts(ctx)).toEqual([])
  })
})
