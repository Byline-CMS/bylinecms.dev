import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.node.ts', '**/*.test.browser.ts'],
    reporter: 'verbose',
    globals: true,
  },
})
