import { fileURLToPath } from 'node:url'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import { defineConfig } from 'vite'

const local = (file: string) => fileURLToPath(new URL(file, import.meta.url))
export default defineConfig({
  root: local('./'),
  plugins: [tanstackStart()],
  resolve: {
    alias: [
      { find: /^@byline\/core$/, replacement: local('./stubs.ts') },
      { find: /^@byline\/client\/server$/, replacement: local('./stubs.ts') },
      { find: /.*integrations\/byline-core\.js$/, replacement: local('./stubs.ts') },
      { find: /.*i18n\/locale-cookie\.js$/, replacement: local('./stubs.ts') },
    ],
  },
  ssr: { noExternal: [/^@byline\//] },
  server: { host: '127.0.0.1', port: 0 },
})
