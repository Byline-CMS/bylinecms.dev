import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const isIntegration = mode === 'integration'
  const testFiles = isIntegration ? ['tests/**/*.integration.test.ts'] : ['**/*.test.node.ts']

  return {
    test: {
      environment: 'node',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
      ...(isIntegration
        ? {
            setupFiles: ['./tests/setup.integration.ts'],
            fileParallelism: false,
            maxWorkers: 1,
            isolate: false,
          }
        : {}),
    },
  }
})
