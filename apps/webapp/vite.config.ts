import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

// Inline every `@byline/*` package through Vite's SSR pipeline. The
// regex catches future packages without requiring a config edit. The
// dual `environments.ssr.resolve.noExternal` + legacy `ssr.noExternal`
// is required: TanStack Start's dev SSR uses the Vite 8 environments
// API, while build-time + older code paths still consult `ssr.noExternal`.
const bylineSsrNoExternal = [/^@byline\//]

// Packages that load platform-specific native binaries (or are CJS-only
// and therefore can't run through Vite's ESM module runner) must be
// kept external so Node resolves them at runtime instead.
//   - sharp + @byline/storage-local — image processing (libvips)
//   - @byline/db-postgres — depends on `pg` native bindings
//   - @byline/admin — re-exports server-only code that imports the above
//   - pino — CJS entrypoints don't execute under Vite's module runner
const ssrExternal = [
  'sharp',
  'pino',
  '@byline/storage-local',
  '@byline/admin',
  '@byline/db-postgres',
]

const config = defineConfig({
  server: {
    port: 5173,
  },
  resolve: {
    tsconfigPaths: true,
  },
  environments: {
    ssr: {
      resolve: {
        noExternal: bylineSsrNoExternal,
      },
    },
  },
  ssr: {
    noExternal: bylineSsrNoExternal,
    external: ssrExternal,
  },
  // Mirror the externals into Vite's client-side dep pre-bundling step.
  // TanStack Start strips server-only imports from server-fn modules
  // during its own compile pass, but `optimizeDeps` runs BEFORE that
  // and tries to pre-bundle anything reachable from a client file —
  // including transitive imports through `@byline/admin/admin-*` barrels.
  //
  // `@base-ui/react` and `@base-ui/utils` need eager pre-bundling for
  // two reasons working in tension:
  //
  //   1. `@base-ui/utils/store/useStore` imports `use-sync-external-store/
  //      shim`, which is pure CJS (`module.exports = require(...)`).
  //      Vite's CJS-to-ESM conversion can fail to synthesize the named
  //      `useSyncExternalStore` export when the module is discovered
  //      mid-graph — the browser then throws SyntaxError on first import.
  //      Pre-bundling as an upfront optimization unit fixes synthesis.
  //
  //   2. @byline/ui imports many @base-ui/react subpaths (`/accordion`,
  //      `/dialog`, etc.) and each LATE discovery triggers a re-optimize
  //      that shifts cache hashes — leaving in-flight imports referencing
  //      old hashes. Eager `include` brings them into the first
  //      optimization pass and reduces re-optimization churn.
  //
  // `entries` is required so Vite's crawler walks the byline scaffold
  // (its file imports start outside `index.html`); without it, the
  // optimizer doesn't see anything reached only via TanStack file-route
  // codegen and Lazy components.
  optimizeDeps: {
    exclude: ssrExternal,
    include: [
      '@base-ui/react',
      '@base-ui/utils',
      'use-sync-external-store/shim',
      'use-sync-external-store/shim/with-selector',
    ],
  },
  plugins: [
    devtools(),
    nitro({
      // @byline/ui ships compiled JS that does `import './foo_module.css'`.
      // @byline/host-tanstack-start re-exports route factories from
      // @byline/ui at runtime in the SSR graph. Nitro externalizes
      // node_modules by default, which sends those imports to Node's
      // ESM loader — which can't handle .css. Inlining both packages
      // through Nitro's pipeline lets Vite's CSS plugin process the
      // side-effect imports.
      noExternals: ['@byline/ui', '@byline/host-tanstack-start'],
      // When Nitro inlines `@byline/host-tanstack-start` it pulls in
      // `@byline/core`, which depends on pino. Pino's CJS entry can't be
      // bundled, so we externalize it (and other native deps) here at
      // the Nitro level — Vite's `ssr.external` only applies to Vite's
      // own builder, not Nitro's.
      rollupConfig: {
        external: ['pino', 'sharp', /^@byline\/(admin|db-postgres|storage-local)/],
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  clearScreen: false,
})

export default config
