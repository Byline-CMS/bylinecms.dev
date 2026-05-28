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
  },
  source: {
    entry: {
      index: ['./src/**/!(*.test).ts?(x)', './src/**/*.json'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
  plugins: [pluginReact()],
})
