import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const isIntegration = mode === 'integration'
  return {
    test: {
      environment: 'node',
      include: isIntegration ? ['tests/**/*.integration.test.ts'] : ['**/*.test.node.ts'],
      reporter: 'verbose',
      globals: true,
      ...(isIntegration
        ? {
            setupFiles: ['./tests/setup.integration.ts'],
            fileParallelism: false,
            maxWorkers: 1,
            isolate: false,
            testTimeout: 30_000,
            hookTimeout: 60_000,
          }
        : {}),
    },
  }
})
