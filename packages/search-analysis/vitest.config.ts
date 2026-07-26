import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const testFiles = mode === 'node' ? ['**/*.test.node.ts'] : ['**/*.test.ts']

  return {
    test: {
      environment: 'node',
      include: testFiles,
      reporter: 'verbose',
      globals: true,
    },
  }
})
