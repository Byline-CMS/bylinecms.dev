import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.test.node.ts'],
    // Template-contract and scaffold tests run full ts-morph programs and
    // in-memory typechecks; slow CI runners overrun vitest's 5s default.
    testTimeout: 30_000,
  },
})
