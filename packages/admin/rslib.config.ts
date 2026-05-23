import { pluginReact } from '@rsbuild/plugin-react'
/**
 * rslib build for `@byline/admin`.
 *
 * Mirrors `@byline/ui`'s configuration so admin UI subpaths
 * (`@byline/admin/admin-users/components/*`, `@byline/admin/services`,
 * etc.) emit CSS modules + JSX correctly, while the server-only entries
 * (`@byline/admin`, `@byline/admin/auth`, `@byline/admin/admin-users`,
 * etc.) stay React-free at runtime — `bundle: false` preserves the
 * per-file boundary, so importing a server subpath never drags the
 * peer-React UI subpaths into the module graph.
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
      index: ['./src/**/!(*.stories|*.test).ts?(x)', './src/**/*.module.css'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
  plugins: [pluginReact()],
})
