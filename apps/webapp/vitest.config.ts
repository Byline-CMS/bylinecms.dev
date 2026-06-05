import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Support both .ts and .tsx tests in node/jsdom modes.
  const testFiles =
    mode === 'node'
      ? ['**/*.test.node.ts', '**/*.test.node.tsx']
      : ['**/*.test.ts', '**/*.test.tsx']

  return {
    plugins: [react()],
    // Resolve the `@/*` → `./src/*` tsconfig path alias so tests can use
    // value imports via `@/` (matching app code). Type-only `@/` imports are
    // erased at transform and never needed resolution; value imports do.
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      setupFiles: './vitest.setup.node.ts',
      environment: mode === 'node' ? 'node' : 'jsdom',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
