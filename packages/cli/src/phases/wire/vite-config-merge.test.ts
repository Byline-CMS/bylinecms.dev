import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { analyzeUserConfig, extractCanonicalPieces } from './vite-config-merge.js'

const CANONICAL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../templates/host/vite.config.ts'),
  'utf8'
)

/**
 * The shape the TanStack Start CLI emits. The Sentry external is deliberate:
 * it lives under `rollupConfig`, a different key from the `rolldownConfig`
 * Byline writes, and must survive the merge untouched.
 */
const STOCK_STARTER = `import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
`

describe('canonical extraction', () => {
  // A contract test against the real template: if someone renames or removes a
  // Byline-owned piece there, the merge silently stops applying it. Extraction
  // must fail loudly instead.
  it('finds every Byline-owned piece in the shipped canonical config', () => {
    const pieces = extractCanonicalPieces(CANONICAL)

    expect([...pieces.statements.keys()]).toEqual([
      'browserAsyncHooksShim',
      'browserAsyncHooksAlias',
      'bylineSsrNoExternal',
      'ssrExternal',
    ])
    expect([...pieces.configProps.keys()]).toEqual(['environments', 'ssr', 'optimizeDeps'])
    expect([...pieces.nitroProps.keys()]).toEqual(['noExternals', 'rolldownConfig'])
  })

  it('throws rather than silently omitting a renamed piece', () => {
    const renamed = CANONICAL.replace('const ssrExternal =', 'const somethingElse =')
    expect(() => extractCanonicalPieces(renamed)).toThrow(/ssrExternal/)
  })
})

describe('merging into a host config', () => {
  const canonical = extractCanonicalPieces(CANONICAL)

  it('plans every insertion for a stock TanStack Start config', () => {
    const analysis = analyzeUserConfig(STOCK_STARTER, canonical)
    expect(analysis.kind).toBe('mergeable')
    if (analysis.kind !== 'mergeable') return

    expect(analysis.plan.unplaced).toEqual([])
    expect(analysis.plan.changes.join('\n')).toContain('browserAsyncHooksShim')
    expect(analysis.plan.changes.join('\n')).toContain('environments, ssr, optimizeDeps')
    expect(analysis.plan.changes.join('\n')).toContain('nitro noExternals, rolldownConfig')
  })

  it('produces a config carrying every required setting', () => {
    const analysis = analyzeUserConfig(STOCK_STARTER, canonical)
    if (analysis.kind !== 'mergeable') throw new Error('expected mergeable')
    const merged = analysis.plan.apply()

    // Boot-critical.
    expect(merged).toContain('noExternal: bylineSsrNoExternal')
    // Hydration-critical.
    expect(merged).toContain('use-sync-external-store/shim')
    // Production-critical.
    expect(merged).toContain("noExternals: ['@byline/ui'")
    expect(merged).toContain('rolldownConfig')
    // Imports the inserted code depends on.
    expect(merged).toContain('fileURLToPath')
    expect(merged).toContain('Plugin')
    // Registered ahead of the host's own plugins.
    expect(merged.indexOf('browserAsyncHooksAlias()')).toBeLessThan(merged.indexOf('devtools()'))
  })

  it("leaves the host's own settings intact", () => {
    const analysis = analyzeUserConfig(STOCK_STARTER, canonical)
    if (analysis.kind !== 'mergeable') throw new Error('expected mergeable')
    const merged = analysis.plan.apply()

    // The Sentry external sits under `rollupConfig` — a different key from the
    // `rolldownConfig` Byline adds. Losing it would be a silent regression in
    // the host's own build.
    expect(merged).toContain('rollupConfig')
    expect(merged).toContain('@sentry')
    expect(merged).toContain('tanstackStart()')
    expect(merged).toContain('viteReact()')
    expect(merged).toContain('tsconfigPaths: true')
  })

  it('is idempotent — a merged config needs no further changes', () => {
    const first = analyzeUserConfig(STOCK_STARTER, canonical)
    if (first.kind !== 'mergeable') throw new Error('expected mergeable')

    expect(analyzeUserConfig(first.plan.apply(), canonical).kind).toBe('canonical')
  })

  it('recognises the canonical config itself as already complete', () => {
    expect(analyzeUserConfig(CANONICAL, canonical).kind).toBe('canonical')
  })

  it('reports a key it cannot claim rather than overwriting it', () => {
    // A host that already sets `ssr` may have done so deliberately; merging into
    // it could silently change their externalization.
    const withSsr = STOCK_STARTER.replace(
      'resolve: { tsconfigPaths: true },',
      "resolve: { tsconfigPaths: true },\n  ssr: { external: ['left-alone'] },"
    )
    const analysis = analyzeUserConfig(withSsr, canonical)
    expect(analysis.kind).toBe('mergeable')
    if (analysis.kind !== 'mergeable') return

    expect(analysis.plan.unplaced.join(' ')).toContain('`ssr` is already set')
    expect(analysis.plan.apply()).toContain('left-alone')
  })

  it('declines a config with no inline defineConfig object', () => {
    const indirect = `import { defineConfig } from 'vite'
const options = { plugins: [] }
export default defineConfig(options)
`
    const analysis = analyzeUserConfig(indirect, canonical)
    expect(analysis.kind).toBe('unrecognized')
    if (analysis.kind !== 'unrecognized') return
    expect(analysis.reason).toContain('defineConfig')
  })

  it('declines a config that does not parse', () => {
    const analysis = analyzeUserConfig('export default defineConfig({ plugins: [ }\n', canonical)
    expect(analysis.kind).toBe('unrecognized')
  })
})
