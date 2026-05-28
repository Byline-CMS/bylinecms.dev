import { defineConfig } from 'vitest/config'

// Mirrors the dual-mode pattern @byline/core uses. Node mode picks up
// `*.test.node.ts(x)` (pure, no DOM); jsdom mode picks up the remaining
// `*.test.ts(x)`. The package-level `test` script runs node mode by
// default; the React-context tests use `.test.ts` (jsdom) and can be
// run via `vitest --mode=jsdom`.
export default defineConfig(({ mode }) => {
  const testFiles =
    mode === 'node'
      ? ['**/*.test.node.ts', '**/*.test.node.tsx']
      : ['**/*.test.ts', '**/*.test.tsx']

  return {
    test: {
      environment: mode === 'node' ? 'node' : 'jsdom',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
