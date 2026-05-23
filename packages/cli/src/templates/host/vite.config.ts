import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// Browser-only stub for `node:async_hooks`. @byline/core's logger module does
// `await import('node:async_hooks')` at top level and falls back to a no-op
// store on failure — but Vite's externalized-Node-builtin shim warns on every
// property access (including `.then`), polluting the dev console. Aliasing to
// our own shim short-circuits the warnings while preserving identical runtime
// behaviour. SSR keeps the real Node module via the unscoped import.
const browserAsyncHooksShim = fileURLToPath(
  new URL('./byline/async-hooks.browser.ts', import.meta.url),
)

// Vite plugin form of the alias above. `EnvironmentResolveOptions.alias`
// doesn't exist in Vite 8's per-environment types, so we scope the
// rewrite via `this.environment.name` inside `resolveId`. SSR keeps the
// real Node module untouched.
const browserAsyncHooksAlias = (): Plugin => ({
  name: 'byline:browser-async-hooks-alias',
  enforce: 'pre',
  resolveId(source) {
    if (source !== 'node:async_hooks') return null
    if (this.environment?.name !== 'client') return null
    return browserAsyncHooksShim
  },
})

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
//   - @byline/storage-s3 — bundles the AWS SDK; keep external for Node resolution
//   - @byline/db-postgres — depends on `pg` native bindings
//   - pino — CJS entrypoints don't execute under Vite's module runner
//
// `@byline/admin` is intentionally NOT externalised: it now hosts
// React admin UI subpaths (`/admin-users/components/*`, `/services`,
// `/auth/components/sign-in-form`, etc.) whose compiled JS does
// `import './foo_module.css'`. Node's ESM loader can't handle `.css`,
// so admin must flow through Vite's SSR pipeline where the CSS plugin
// resolves the side-effect imports. Server-only admin subpaths reach
// db-postgres / storage adapters through composition at runtime, not
// through `@byline/admin`'s own import graph, so this is safe.
const ssrExternal = [
  'sharp',
  'pino',
  '@byline/storage-local',
  '@byline/storage-s3',
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
    // In Vite 8's environments API, per-environment `optimizeDeps` and
    // `resolve` take precedence over root-level equivalents. TanStack Start's
    // plugin populates `environments.client.optimizeDeps.include` with its
    // own entries, which supersedes any root-level include. Client-side
    // pre-bundling overrides therefore live here, alongside the SSR
    // resolver config.
    client: {
      optimizeDeps: {
        // Vite's `resolve.alias` runs in its own request pipeline — it does
        // NOT propagate into the dep-optimizer's pre-bundle pass. @byline/core
        // is pre-bundled, so we additionally rewrite `node:async_hooks` inside
        // Rolldown. Without this, the optimized chunk keeps a bare
        // `import('node:async_hooks')` that Vite's runtime then resolves to
        // its noisy browser-external stub.
        // Force pre-bundling of @byline/ui so Vite's dep optimizer walks
        // into it and inlines its CJS deps — notably
        // `@base-ui/utils/store/useStore` and `use-sync-external-store/shim`.
        //
        // Without this, those CJS modules are reached via Vite's regular
        // module pipeline at runtime, where the on-the-fly CJS->ESM interop
        // can fail to synthesise the named `useSyncExternalStore` export.
        // The browser then throws a SyntaxError, the route never hydrates,
        // and forms fall back to native GET behaviour.
        //
        // @byline/ui ships React-side code through a single
        // `@byline/ui/react` entry point — there are no per-area subpaths
        // to pre-bundle individually. That single-entry shape is also why
        // pre-bundling here is now safe: the React Contexts in
        // `services/*` resolve to one module instance regardless of which
        // file in @byline/ui imports them.
        //
        // @byline/ai and its plugin subpaths are pre-bundled for the same
        // reason — the published package ships compiled JS that the dep
        // optimizer needs to walk so its CJS interop and `node:async_hooks`
        // rewrite (below) take effect in the client bundle.
        //
        // We intentionally do NOT pre-bundle @byline/host-tanstack-start
        // subpaths — they transitively pull in @tanstack/start-server-core,
        // which references Vite-virtual modules (e.g.
        // `tanstack-start-injected-head-scripts:v`) that the dep optimizer
        // cannot resolve.
        include: [
          '@byline/ui/react',
          '@byline/ai',
          '@byline/ai/plugins/text',
          '@byline/ai/plugins/lexical',
        ],
        rolldownOptions: {
          plugins: [
            {
              name: 'alias-node-async-hooks',
              resolveId(source) {
                if (source === 'node:async_hooks') {
                  return browserAsyncHooksShim
                }
                return null
              },
            },
          ],
        },
      },
    },
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
  optimizeDeps: {
    exclude: ssrExternal,
  },
  plugins: [
    browserAsyncHooksAlias(),
    devtools(),
    nitro({
      preset: 'node',
      // @byline/ui, @byline/admin, and @byline/host-tanstack-start all
      // ship compiled JS that does `import './foo_module.css'`. Nitro
      // externalizes node_modules by default, which would send those
      // imports to Node's ESM loader — which can't handle .css.
      // Inlining these three packages through Nitro's pipeline lets
      // Vite's CSS plugin process the side-effect imports.
      noExternals: ['@byline/ui', '@byline/admin', '@byline/host-tanstack-start'],
      // When Nitro inlines `@byline/host-tanstack-start` it pulls in
      // `@byline/core`, which depends on pino. Pino's CJS entry can't be
      // bundled, so we externalize it (and other native deps) here at
      // the Nitro level — Vite's `ssr.external` only applies to Vite's
      // own builder, not Nitro's.
      rolldownConfig: {
        external: [
          // Explicit problem-packages kept external so Node resolves them
          // as singletons from the module cache at runtime.
          //
          // react + react-dom MUST be here. TanStack Start's Nitro build
          // otherwise wraps them in a `__commonJSMin` closure inside `_libs`
          // — a self-contained module that is NOT registered in Node's module
          // cache. Any code that calls the real `require('react')` (e.g.
          // `use-sync-external-store/shim` pre-bundled inside @byline/ui's
          // dist files) gets a second, separate React instance. Because
          // `ReactSharedInternals.H` (the dispatcher) is set on the `_libs`
          // closure-React during rendering, the other instance has H=null and
          // throws: "Cannot read properties of null (reading
          // 'useSyncExternalStore')".
          //
          // Marking react/react-dom as bundler externals forces `_libs` to
          // emit `__require('react')` instead of inlining a closure, so both
          // code paths hit the same Node.js module-cache singleton.
          'react',
          'react-dom',
          'pino',
          'sharp',
          /^@byline\/(db-postgres|storage-local|storage-s3)/,
        ],
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  clearScreen: false,
})

export default config
