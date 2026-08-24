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
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(packageDir, 'dist/b.js'), 'utf8')

describe('standalone analytics agent', () => {
  it('stays below the 2 KB gzipped budget', () => {
    expect(gzipSync(source).byteLength).toBeLessThanOrEqual(2_048)
  })

  it('contains no client storage writes, cookie access, fingerprinting, or GPC branching', () => {
    expect(source).not.toMatch(/setItem|removeItem|clear\(|sessionStorage|indexedDB/iu)
    expect(source).not.toMatch(/document\.cookie|canvas|webgl|font/iu)
    expect(source).not.toMatch(/globalPrivacyControl|Sec-GPC/iu)
  })

  it('takes an application-owned endpoint and uses a text/plain body', () => {
    expect(source).not.toContain('/api/events')
    expect(source).toContain('text/plain')
  })
})
