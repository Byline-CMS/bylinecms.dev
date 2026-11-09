import { fileURLToPath } from 'node:url'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import { bylineNitroFeatures } from '@byline/host-tanstack-start/vite'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

const local = (file: string) => fileURLToPath(new URL(file, import.meta.url))
const stubs = local('../sign-in-start/stubs.ts')

// BYLINE_TEST_NITRO_FEATURES=default builds with Nitro's own feature defaults,
// which lets run.mjs show the regression this fixture guards against.
const features =
  process.env.BYLINE_TEST_NITRO_FEATURES === 'default' ? undefined : bylineNitroFeatures()

export default defineConfig({
  root: local('./'),
  plugins: [
    nitro({ preset: 'node', output: { dir: local('./.output') }, features }),
    tanstackStart(),
  ],
  resolve: {
    alias: [
      { find: /^@byline\/core$/, replacement: stubs },
      { find: /^@byline\/client\/server$/, replacement: stubs },
      { find: /.*integrations\/byline-core\.js$/, replacement: stubs },
      { find: /.*i18n\/locale-cookie\.js$/, replacement: stubs },
    ],
  },
  ssr: { noExternal: [/^@byline\//] },
  logLevel: 'warn',
})
