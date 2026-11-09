import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTestContext } from '../../test-helpers.js'
import { wireViteConfig } from './vite-config.js'
import type { Context } from '../../context.js'

// A merge that throws while being applied must come back as a clear blocked
// result, not escape as an exception. No real config throws after the
// in-place update fix, so the failure is injected.
vi.mock('./vite-config-merge.js', async (importActual) => {
  const actual = await importActual<typeof import('./vite-config-merge.js')>()
  return {
    ...actual,
    analyzeUserConfig: () => ({
      kind: 'mergeable',
      plan: {
        changes: ['update nitro rolldownConfig'],
        unplaced: [],
        apply() {
          throw new Error('Manipulation error: A syntax error was inserted.\n\nvite.config.ts:1:1')
        },
      },
    }),
  }
})

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe('Vite config merge failure', () => {
  it('blocks with the reason and the canonical snippet, leaving the config untouched', async () => {
    const ctx = createTestContext()
    contexts.push(ctx)
    const host =
      "import { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [] })\n"
    writeFileSync(ctx.resolve('vite.config.ts'), host)

    const preview = await wireViteConfig.preview(ctx)
    expect(preview.status).toBe('blocked')
    expect(preview.message).toContain('could not be merged into it')
    expect(preview.message).toContain('A syntax error was inserted.')
    expect(preview.message).not.toContain('vite.config.ts:1:1')
    expect(preview.message).toContain('byline init --from wire')
    expect(preview.snippet).toBe(readFileSync(`${ctx.templatesDir()}/host/vite.config.ts`, 'utf8'))
    expect(preview.writes).toBeUndefined()
    expect(readFileSync(ctx.resolve('vite.config.ts'), 'utf8')).toBe(host)
    expect(readdirSync(ctx.cwd).some((name) => name.startsWith('vite.config.ts.bak-'))).toBe(false)
  })
})
