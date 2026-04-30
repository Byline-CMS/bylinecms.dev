import { fileURLToPath } from 'node:url'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const emptyModule = fileURLToPath(
  new URL('./src/integrations/byline/empty-module.ts', import.meta.url)
)

export default defineConfig({
  server: {
    port: 5173,
  },
  // Bundle these packages during SSR so Vite handles their CSS module imports
  // (Node.js can't natively process .css files).
  resolve: {
    tsconfigPaths: true,
    alias: [
      // `@node-rs/argon2`'s package.json has `"browser": "browser.js"`, and
      // browser.js is `export * from '@node-rs/argon2-wasm32-wasi'` — a WASM
      // peer we don't install. When Vite resolves argon2 for the client
      // environment (via transitive imports through `@byline/admin/*`
      // subpaths in admin server-fn modules), it hits this dead reference
      // and fails import-analysis. Aliasing the WASM peer to an empty stub
      // lets resolution succeed; the actual argon2 calls live behind
      // `createServerFn` and never execute on the client. Server-side
      // (Node) always picks `index.js`, so the alias is a no-op there.
      { find: '@node-rs/argon2-wasm32-wasi', replacement: emptyModule },
    ],
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
  // The same packages need to be kept out of Vite's client-side dep
  // pre-bundling step. TanStack Start strips server-only imports from
  // server-fn modules during its own compile pass, but Vite's
  // `optimizeDeps` runs BEFORE that and tries to pre-bundle anything
  // a client-reachable file imports — including transitive
  // `@node-rs/argon2` reached via `@byline/admin/admin-*` subpath
  // barrels. Excluding the package roots here keeps Vite from
  // touching them on the client side; once TanStack Start's compile
  // runs, the imports are already gone from the client output.
  optimizeDeps: {
    exclude: [
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
