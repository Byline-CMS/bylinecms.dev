import { fileURLToPath } from 'node:url'

import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import { bylineClientHookBoundary } from '@byline/host-tanstack-start/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type Plugin, type PluginOption } from 'vite'

// Browser-only stub for `node:async_hooks`. @byline/core's logger module does
// `await import('node:async_hooks')` at top level and falls back to a no-op
// store on failure — but Vite's externalized-Node-builtin shim warns on every
// property access (including `.then`), polluting the dev console. Aliasing to
// our own shim short-circuits the warnings while preserving identical runtime
// behaviour. SSR keeps the real Node module via the unscoped import.
const browserAsyncHooksShim = fileURLToPath(
  new URL('./byline/async-hooks.browser.ts', import.meta.url)
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

// Dev-only: let content `.md` URLs reach the TanStack Start SSR handler.
// Vite's dev middlewares claim extension-bearing requests whose `Accept`
// header is not `text/html` (curl, agents, Playwright `request` — exactly
// the clients the markdown surface serves) and 404 them as missing static
// files before Start's catch-all runs. Production has no Vite middleware,
// so without this shim dev and prod would diverge on the feature's primary
// consumer shape. Normalising `Accept` on content `.md` GETs makes Vite's
// fallback hand them to SSR, where the `{$path}[.]md` routes match. Routes
// still return `text/markdown` — only the *request* header is touched.
const devMarkdownPassthrough = (): Plugin => ({
  name: 'byline:dev-markdown-passthrough',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const pathname = req.url?.split('?')[0] ?? ''
      if (req.method === 'GET' && pathname.endsWith('.md')) {
        req.headers.accept = 'text/html'
      }
      next()
    })
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
        //
        // @byline/ui is intentionally NOT included here — the `development`
        // export condition in `packages/ui/package.json` routes dev consumers
        // to `src/react.ts`, which Vite serves through its own module graph
        // (with HMR per source file). Pre-bundling would re-introduce the
        // dist round-trip that this whole arrangement is meant to bypass.
        // It's listed in `exclude` below for belt-and-suspenders safety.
        // @byline/ui is served from source in dev (excluded below), so its
        // transitive CJS leaves are reached through Vite's on-demand pipeline
        // rather than being inlined into a pre-bundle. `use-sync-external-store`
        // ships its named exports behind a `process.env.NODE_ENV` re-export
        // (`module.exports = require('../cjs/.../with-selector.development.js')`).
        // When that module is emitted as a standalone optimized chunk via the
        // discovery path, Vite's interop only synthesises a default export, so a
        // named `import { useSyncExternalStoreWithSelector }` (from @base-ui/utils'
        // store) throws "does not provide an export named …" and the route never
        // hydrates. Listing the CJS leaves as explicit entries makes Vite walk
        // the re-export with cjs-module-lexer and emit a proper named-export
        // facade, so the named import resolves regardless of which path reaches
        // it.
        include: [
          '@byline/ai',
          '@byline/ai/plugins/text',
          '@byline/ai/plugins/lexical',
          'use-sync-external-store/shim',
          'use-sync-external-store/shim/with-selector',
        ],
        exclude: ['@byline/ui/react'],
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
        // No `include` entries here — workspace consumers don't need them.
        // Vite's scanner walks the workspace @byline/ui source directly via
        // the symlinked workspace package, and the CJS deps that motivate
        // the published-consumer include list (see
        // packages/cli/src/templates/host/vite.config.ts) are auto-discovered
        // through the source graph here.
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
    // Bundle composition treemap. Off by default — opt in with `ANALYZE=1
    // pnpm --filter @byline/webapp build`, then open the emitted
    // `bundle-stats.html` files (one per Vite environment, scattered
    // through `.output/` and `node_modules/.nitro/`). Works through
    // Rolldown's Rollup-plugin compat layer.
    process.env.ANALYZE
      ? (visualizer({
          filename: 'bundle-stats.html',
          emitFile: true,
          gzipSize: true,
          template: 'treemap',
        }) as PluginOption)
      : null,
    browserAsyncHooksAlias(),
    bylineClientHookBoundary(),
    devMarkdownPassthrough(),
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
    // Pure file-based routing. The frontend locale tree is a required
    // `$lng` segment (`src/routes/$lng`); the router's isomorphic
    // `rewrite` (see `src/router.tsx` + `src/i18n/locale-rewrite.ts`)
    // prepends the default locale to bare URLs and strips it on output,
    // so no literal-locale shim tree / virtual route config is needed.
    tanstackStart(),
    viteReact(),
  ],
  clearScreen: false,
})

export default config
