import { pluginReact } from '@rsbuild/plugin-react'
/**
 * rslib config — same shape as @byline/ui. Per-file emit (bundle: false)
 * so consumers can deep-import via subpath patterns (`./server-fns/*`,
 * `./admin-shell/chrome/*`, etc.) and tree-shaking works at the file
 * level. CSS modules are emitted as siblings of their .js outputs;
 * `sideEffects: ['**\/*.css']` in package.json keeps the host bundler
 * from dropping them.
 */
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
    cssModules: {},
    emitCss: true,
  },
  source: {
    entry: {
      index: ['./src/**/!(*.stories|*.test).ts?(x)', './src/**/*.module.css', './src/**/*.css'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
  plugins: [pluginReact()],
})
