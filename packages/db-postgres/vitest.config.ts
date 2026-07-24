import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Unit:        vitest run --mode=node          → *.test.node.ts (currently none)
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
      // The flatten/reconstruct and storage tests do live Postgres work
      // against a shared byline_test DB. Pure-JS argon2id in the admin
      // suite alone takes 10+ s. Keep the global timeout generous.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      ...(isIntegration
        ? {
            // Same shape as @byline/client integration config: migrate
            // once via globalSetup, truncate per file via setupFiles, and
            // force serial file execution (maxWorkers: 1 + isolate: false
            // replaces the pre-Vitest-4 `singleFork: true` pool option)
            // so per-file TRUNCATEs don't wipe each other's seeded
            // fixtures mid-run.
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
