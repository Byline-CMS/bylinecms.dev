/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchProvider } from '@byline/core'
import { createPortableSearchAnalyzer } from '@byline/search-analysis'
import { beforeAll, describe, expect, it } from 'vitest'

import type { SearchConformanceHooks } from '../index.js'

export function capabilitiesSuite(hooks: SearchConformanceHooks): void {
  let provider: SearchProvider

  describe.sequential('SearchProvider capabilities', () => {
    beforeAll(async () => {
      provider = await hooks.createProvider()
    })

    it('declares one analysis strategy and the shared full-text matching floor', () => {
      const fullText = provider.capabilities.fullText

      expect(fullText.nativeAnalysis || fullText.portableAnalysis).toBe(true)
      expect(fullText).toMatchObject({
        allTerms: true,
        anyTerms: true,
        minimumShouldMatch: true,
        phrase: true,
      })
    })

    it('declares portable analysis when a portable-provider factory is supplied', async () => {
      if (hooks.createPortableProvider == null) return
      const portableProvider = await hooks.createPortableProvider(createPortableSearchAnalyzer())
      expect(portableProvider.capabilities.fullText.portableAnalysis).toBe(true)
    })
  })
}
