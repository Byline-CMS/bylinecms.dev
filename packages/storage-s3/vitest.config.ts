import { defineConfig } from 'vitest/config'

export default defineConfig(() => ({
  test: {
    environment: 'node',
    include: ['src/**/*.test.node.ts'],
    reporter: 'verbose',
    globals: true,
  },
}))
