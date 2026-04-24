import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
  },
  // Bundle these packages during SSR so Vite handles their CSS module imports
  // (Node.js can't natively process .css files).
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    noExternal: ['@infonomic/uikit'],
    // Packages that load platform-specific native `.node` binaries at
    // runtime via dynamic require(). Rollup cannot bundle these, so we
    // keep them external and let Node.js resolve them from node_modules
    // at runtime.
    //   - sharp + @byline/storage-local — image processing
    //   - @node-rs/argon2 + @byline/admin — password hashing lives in
    //     @byline/admin/auth now (reached from admin server fns + seed)
    //   - @byline/db-postgres — adapter depends on pg native bindings
    external: [
      'sharp',
      '@byline/storage-local',
      '@node-rs/argon2',
      '@byline/admin',
      '@byline/db-postgres',
    ],
  },
  plugins: [
    tanstackStart(),
    // NOTE: react() must come AFTER tanstackStart()
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
})
