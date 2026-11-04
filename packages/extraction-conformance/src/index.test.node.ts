/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ExtractionProvider } from '@byline/core'
import { ExtractionProviderError } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { defineExtractionProviderConformance, loadFixtures, SENTINELS } from './index.js'

// Registers against a minimal honest driver, so this file proves that the wrapper
// registers real tests. The kit's rules themselves are proven in cases.test.node.ts.
const fixtures = loadFixtures()

const provider: ExtractionProvider = {
  name: 'wrapper-honest',
  capabilities: {
    ocr: false,
    markdown: false,
    tables: false,
    formulas: false,
    charts: false,
    coordinates: false,
    pageMap: false,
    structure: false,
    formats: ['application/pdf'],
  },
  extract: async (input) => {
    input.signal?.throwIfAborted()
    if (input.mimeType !== 'application/pdf') {
      throw new ExtractionProviderError('unsupported', { failureScope: 'file', retryable: false })
    }
    if (input.data instanceof Uint8Array && Buffer.from(input.data).equals(fixtures.corrupt)) {
      throw new ExtractionProviderError('corrupt', { failureScope: 'file', retryable: false })
    }
    const plainText = SENTINELS.join(' ')
    return {
      provider: 'wrapper-honest',
      plainText,
      metadata: {},
      signals: { totalChars: plainText.length },
    }
  },
}

defineExtractionProviderConformance({ name: 'wrapper', createProvider: () => provider })

describe('the package', () => {
  it('ships the fixtures it reads', () => {
    expect(fixtures.sentinel.length).toBeGreaterThan(0)
    expect(fixtures.truncated.length).toBeGreaterThan(0)
    expect(fixtures.corrupt.length).toBeGreaterThan(0)
  })
})
