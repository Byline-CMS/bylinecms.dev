import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Support both .ts and .tsx tests in node/jsdom modes.
  const testFiles =
    mode === 'node'
      ? ['**/*.test.node.ts', '**/*.test.node.tsx']
      : ['**/*.test.ts', '**/*.test.tsx']

  return {
    plugins: [react(), tsconfigPaths()],
    test: {
      setupFiles: './vitest.setup.node.ts',
      environment: mode === 'node' ? 'node' : 'jsdom',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
