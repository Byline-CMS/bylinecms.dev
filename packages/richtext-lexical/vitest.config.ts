import { defineConfig } from 'vitest/config'

// Mirrors the dual-mode pattern used by `@byline/core`. Node-mode picks
// up `*.test.node.ts(x)` files (pure, no DOM); jsdom-mode picks up the
// remaining `*.test.ts(x)`. The package-level `test` script runs node
// mode so CI surfaces the framework-agnostic test surface without
// needing a working jsdom/Lexical setup.
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
