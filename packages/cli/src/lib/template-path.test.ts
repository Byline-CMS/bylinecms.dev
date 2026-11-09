/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { recognizeGeneratedRoutesSource } from './route-config.js'
import { normalizeTemplateSource } from './template-path.js'

const CURRENT_NOTICE = `/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */`

const LEGACY_NOTICE = `/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */`

function toLegacyNotice(source: string): string {
  return source
    .replace('This Source Code Form is subject', 'This Source Code is subject')
    .replace('https://mozilla.org/MPL/2.0/', 'http://mozilla.org/MPL/2.0/')
}

describe('normalizeTemplateSource', () => {
  it('compares the legacy MPL notice wording as the current wording', () => {
    expect(normalizeTemplateSource(`${LEGACY_NOTICE}\nexport {}\n`)).toBe(
      normalizeTemplateSource(`${CURRENT_NOTICE}\nexport {}\n`)
    )
  })

  it('still distinguishes sources that differ outside the notice', () => {
    expect(normalizeTemplateSource(`${LEGACY_NOTICE}\nexport const a = 1\n`)).not.toBe(
      normalizeTemplateSource(`${CURRENT_NOTICE}\nexport const a = 2\n`)
    )
  })

  it('recognizes a routes.ts installed from a template with the legacy notice', () => {
    const canonical = readFileSync(
      fileURLToPath(new URL('../templates/byline/routes.ts', import.meta.url)),
      'utf8'
    )
    expect(canonical).toContain('This Source Code Form is subject')
    const installed = toLegacyNotice(canonical)
    expect(installed).not.toBe(canonical)
    expect(recognizeGeneratedRoutesSource(installed, canonical)).not.toBeNull()
  })
})
