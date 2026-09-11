import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Mirrors the dual-mode pattern used by `@byline/core`. Node-mode picks
// up `*.test.node.ts(x)` files (pure, no DOM); jsdom-mode picks up the
// remaining `*.test.ts(x)`. The package-level `test` script runs node
// mode so CI surfaces the framework-agnostic test surface without
// needing a working jsdom/Lexical setup.
//
// jsdom mode carries the React plugin because the extension graph is
// React-bearing: a test that builds the default extension set pulls in
// `.tsx` extension modules, and the package tsconfig sets
// `jsx: "preserve"`, so without a transform those fail to parse.
export default defineConfig(({ mode }) => {
  const testFiles =
    mode === 'node'
      ? ['**/*.test.node.ts', '**/*.test.node.tsx']
      : ['**/*.test.ts', '**/*.test.tsx']

  return {
    plugins: mode === 'node' ? [] : [react()],
    test: {
      environment: mode === 'node' ? 'node' : 'jsdom',
      setupFiles: mode === 'node' ? [] : ['./src/field/test-support/jsdom-setup.ts'],
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
