import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Unit:        vitest run --mode=node          → *.test.node.ts
  // Integration: vitest run --mode=integration   → **/*.test.ts under src/**/tests/
  //              plus tests/**/*.test.ts — the conformance entry
  //              (tests/conformance.integration.test.ts) that runs the
  //              shared @byline/db-conformance storage suite.
  const isIntegration = mode === 'integration'
  const testFiles = isIntegration
    ? ['src/**/tests/**/*.test.ts', 'tests/**/*.test.ts']
    : ['**/*.test.node.ts']

  return {
    test: {
      environment: 'node',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
      // Mirrors db-postgres: live-DB integration tests can take a while
      // (migrations, argon2id hashing in the admin suite). Keep the
      // global timeout generous.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      ...(isIntegration
        ? {
            // Same shape as db-postgres: migrate once via globalSetup,
            // truncate per file via setupFiles, and force serial file
            // execution so per-file TRUNCATEs don't wipe each other's
            // seeded fixtures mid-run.
            globalSetup: ['./tests/_global-setup.ts'],
            setupFiles: ['./tests/_per-file-setup.ts'],
            fileParallelism: false,
            maxWorkers: 1,
            isolate: false,
          }
        : {}),
    },
  }
})
