import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Unit tests:   vitest run --mode=node        → *.test.node.ts
  // Integration:  vitest run --mode=integration → *.integration.test.ts
  const testFiles = mode === 'integration' ? ['**/*.integration.test.ts'] : ['**/*.test.node.ts']

  return {
    test: {
      environment: 'node',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
      // Pure-JS argon2id is 5–10× slower than the previous @node-rs/argon2
      // binding, so tests that hash several passwords (seedUsers / multi-user
      // listing tests) routinely run 5–10 s. The default 5 s timeout is too
      // tight; bump to 30 s globally for this suite.
      testTimeout: 30_000,
    },
  }
})
