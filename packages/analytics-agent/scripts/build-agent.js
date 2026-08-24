import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(packageDir, 'dist')
const result = await build({
  entryPoints: [resolve(packageDir, 'src/standalone.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
})
const source = result.outputFiles?.[0]?.text
if (source == null) throw new Error('esbuild did not produce the analytics agent')

mkdirSync(distDir, { recursive: true })
writeFileSync(resolve(distDir, 'b.js'), source)
writeFileSync(
  resolve(distDir, 'source.js'),
  `export const ANALYTICS_AGENT_SOURCE = ${JSON.stringify(source)};\n`
)
writeFileSync(
  resolve(distDir, 'source.d.ts'),
  'export declare const ANALYTICS_AGENT_SOURCE: string;\n'
)
