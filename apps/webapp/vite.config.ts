import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
  },
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    noExternal: ['@byline/ui'],
    // Packages that load platform-specific native `.node` binaries at
    // runtime via dynamic require(). Rollup cannot bundle these, so we
    // keep them external and let Node.js resolve them from node_modules
    // at runtime.
    //   - sharp + @byline/storage-local — image processing
    //   - @byline/db-postgres — adapter depends on pg native bindings
    external: ['sharp', '@byline/storage-local', '@byline/admin', '@byline/db-postgres'],
  },
  // The same packages need to be kept out of Vite's client-side dep
  // pre-bundling step. TanStack Start strips server-only imports from
  // server-fn modules during its own compile pass, but Vite's
  // `optimizeDeps` runs BEFORE that and tries to pre-bundle anything
  // a client-reachable file imports — including transitive imports
  // reached via `@byline/admin/admin-*` subpath barrels. Excluding the
  // package roots here keeps Vite from touching them on the client side.
  optimizeDeps: {
    exclude: ['sharp', '@byline/storage-local', '@byline/admin', '@byline/db-postgres'],
  },
  plugins: [
    tanstackStart(),
    // NOTE: react() must come AFTER tanstackStart()
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
})
