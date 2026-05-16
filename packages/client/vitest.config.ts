import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Unit tests:   vitest run --mode=node        → *.test.node.ts
  // Integration:  vitest run --mode=integration → *.integration.test.ts
  const isIntegration = mode === 'integration'
  const testFiles = isIntegration ? ['**/*.integration.test.ts'] : ['**/*.test.node.ts']

  return {
    test: {
      environment: 'node',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
      // Integration tests share a real `byline_test` Postgres database.
      // `_global-setup.ts` runs once per `vitest run` and migrates the DB;
      // `_per-file-setup.ts` runs once per test file and truncates all
      // tables in a `beforeAll` so each file starts from a known state.
      //
      // `fileParallelism: false` plus a single-fork pool forces files to
      // run one at a time. Otherwise a sibling file's `beforeAll` truncate
      // would wipe the active file's seeded fixtures mid-run.
      ...(isIntegration
        ? {
            globalSetup: ['./tests/_global-setup.ts'],
            setupFiles: ['./tests/_per-file-setup.ts'],
            fileParallelism: false,
            pool: 'forks',
            poolOptions: { forks: { singleFork: true } },
          }
        : {}),
    },
  }
})
