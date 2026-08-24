/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('@byline/analytics browser boundary', () => {
  it('exports config directly without loading the Node-only root barrel', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(manifest.exports['./config']).toEqual({
      types: './dist/config.d.ts',
      import: './dist/config.js',
      require: './dist/config.js',
    })
  })

  it('keeps runtime Node built-ins out of the browser-safe config module', () => {
    const source = readFileSync(join(packageDir, 'src/config.ts'), 'utf8')
    expect(source).not.toMatch(/(?:from|import\()\s*['"]node:/u)
  })
})
