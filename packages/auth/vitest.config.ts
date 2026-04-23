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
    },
  }
})
