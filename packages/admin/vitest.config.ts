import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Unit tests:   vitest run --mode=node        → *.test.node.ts(x)
  // Component:    vitest run --mode=jsdom       → *.test.ts(x)
  // Integration:  vitest run --mode=integration → *.integration.test.ts
  //
  // The jsdom mode exists because this package ships React components and had
  // no way to run a test for one: the node mode's `*.test.node.ts` glob matched
  // no `.tsx` file, so `path-widget.test.tsx` sat in the tree for months
  // without ever executing. Mirrors `apps/webapp/vitest.config.ts`.
  const testFiles =
    mode === 'integration'
      ? ['**/*.integration.test.ts']
      : mode === 'jsdom'
        ? ['**/*.test.ts', '**/*.test.tsx']
        : ['**/*.test.node.ts', '**/*.test.node.tsx']

  // Only the jsdom glob is broad enough to over-collect: `**/*.test.ts` also
  // matches the node and integration suites, which are written for a different
  // environment. The other modes' globs are already exact, and excluding those
  // patterns there would exclude the very files they include.
  const exclude =
    mode === 'jsdom'
      ? [
          '**/node_modules/**',
          '**/dist/**',
          '**/*.test.node.ts',
          '**/*.test.node.tsx',
          '**/*.integration.test.ts',
        ]
      : ['**/node_modules/**', '**/dist/**']

  return {
    plugins: [react()],
    test: {
      environment: mode === 'jsdom' ? 'jsdom' : 'node',
      include: testFiles,
      exclude,
      reporter: 'verbose',
      globals: true,
      // Pure-JS argon2id is 5–10× slower than the previous @node-rs/argon2
      // binding, so tests that hash several passwords (seedUsers / multi-user
      // listing tests) routinely run 5–10 s. The default 5 s timeout is too
      // tight; bump to 30 s globally for this suite.
      testTimeout: 30_000,
    },
  }
})
