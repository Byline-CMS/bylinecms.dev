import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DEP_SPECS } from '../../manifest/deps.js'
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

  // `optimizeDeps.include` takes bare specifiers that Vite resolves from the
  // host app root. A package that is only ever a transitive dependency is not
  // resolvable there under pnpm's strict layout, so Vite fails to pre-bundle it
  // and the admin route never hydrates. The scaffold smoke test only covers
  // bare imports in scaffolded source, so nothing else catches this.
  it('declares every package named in optimizeDeps.include as a host dependency', () => {
    const environments = extractCanonicalPieces(CANONICAL).configProps.get('environments') ?? ''
    const include = environments.match(/include:\s*\[([^\]]*)\]/)?.[1]
    expect(include, 'canonical config no longer has an optimizeDeps.include array').toBeTruthy()

    const specifiers = [...(include ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1] as string)
    expect(specifiers.length).toBeGreaterThan(0)

    const declared = new Set(DEP_SPECS.map((spec) => spec.name))
    for (const specifier of specifiers) {
      const segments = specifier.split('/')
      const packageName = specifier.startsWith('@')
        ? `${segments[0]}/${segments[1]}`
        : (segments[0] as string)
      expect(declared, `${specifier} is not installed by the CLI`).toContain(packageName)
    }
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

  it('updates a Byline-owned value left stale by an earlier release', () => {
    // Without this, a config merged by an earlier CLI is reported as "already
    // provides Byline's required settings" and silently never receives later
    // fixes to those settings — which is exactly how a missing
    // optimizeDeps.include entry survived an upgrade.
    const merged = (() => {
      const first = analyzeUserConfig(STOCK_STARTER, canonical)
      if (first.kind !== 'mergeable') throw new Error('expected mergeable')
      return first.plan.apply()
    })()
    const stale = merged.replace("'@byline/i18n/react',\n", '')
    expect(stale).not.toBe(merged)

    const analysis = analyzeUserConfig(stale, canonical)
    expect(analysis.kind).toBe('mergeable')
    if (analysis.kind !== 'mergeable') return

    expect(analysis.plan.changes.join(' ')).toContain('update')
    expect(analysis.plan.unplaced).toEqual([])
    const upgraded = analysis.plan.apply()
    expect(upgraded).toContain("'@byline/i18n/react'")
    // The host's own settings must survive an upgrade just as they do an install.
    expect(upgraded).toContain('@sentry')
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
