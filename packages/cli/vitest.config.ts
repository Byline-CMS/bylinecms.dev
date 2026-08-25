import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const isIntegration = mode === 'integration'
  return {
    test: {
      environment: 'node',
      include: isIntegration
        ? ['tests/**/*.integration.test.ts']
        : ['src/**/*.test.{ts,tsx}', 'src/**/*.test.node.ts'],
      // Template-contract and scaffold tests run full ts-morph programs and
      // in-memory typechecks; live provisioning also needs room for server DDL.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      ...(isIntegration
        ? {
            // Loads `.env.test` before each test module imports. The suite
            // reads its admin URLs at module scope, so this cannot wait for
            // a `beforeAll`. See tests/_setup-env.ts.
            setupFiles: ['./tests/_setup-env.ts'],
            fileParallelism: false,
            maxWorkers: 1,
            isolate: false,
          }
        : {}),
    },
  }
})
