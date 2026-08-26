import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Component tests must run under an explicit jsdom mode. The former node-only
  // `*.test.node.ts` glob did not collect `.test.tsx` files at all, so a green
  // package run could otherwise mean that no dashboard component test ran.
  const jsdom = mode === 'jsdom'
  return {
    plugins: [react()],
    test: {
      environment: jsdom ? 'jsdom' : 'node',
      include: jsdom
        ? ['**/*.test.ts', '**/*.test.tsx']
        : ['**/*.test.node.ts', '**/*.test.node.tsx'],
      exclude: jsdom
        ? [
            '**/node_modules/**',
            '**/dist/**',
            '**/*.test.node.ts',
            '**/*.test.node.tsx',
            '**/*.integration.test.ts',
          ]
        : ['**/node_modules/**', '**/dist/**'],
      reporter: 'verbose',
      globals: true,
    },
  }
})
