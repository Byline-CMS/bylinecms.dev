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
    // Native Vite tsconfig-paths resolution (Vite 6+/Vitest 4+). Replaces
    // the deprecated `vite-tsconfig-paths` plugin.
    resolve: { tsconfigPaths: true },
    test: {
      setupFiles: './vitest.setup.node.ts',
      environment: mode === 'node' ? 'node' : 'jsdom',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
