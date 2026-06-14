/**
 * Multi-entry library build. Mirrors `@byline/ui`'s pattern of building
 * an unbundled ESM tree so consumers' bundlers can tree-shake. JSON files
 * (the locale bundles under `src/admin/`) are inlined into their importing
 * module at build time — consumers never load a `.json` URL at runtime,
 * which sidesteps the TanStack Start / Nitro asset-extension quirk that
 * forced the host webapp's translations to be TS modules.
 */

import { pluginReact } from '@rsbuild/plugin-react'
import { defineConfig } from '@rslib/core'

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      bundle: false,
      dts: {
        distPath: './dist',
      },
    },
  ],
  output: {
    cleanDistPath: false,
    distPath: {
      root: './dist',
    },
    // Component CSS Modules (e.g. the LanguageMenu) are emitted alongside
    // their JS in the unbundled tree, the same way `@byline/ui` ships its
    // component styles — package components use CSS / CSS Modules, never
    // Tailwind. The consumer's bundler links the emitted `.css`.
    cssModules: {},
    emitCss: true,
  },
  source: {
    entry: {
      index: ['./src/**/!(*.test).ts?(x)', './src/**/*.json', './src/**/*.module.css'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
  plugins: [pluginReact()],
})
