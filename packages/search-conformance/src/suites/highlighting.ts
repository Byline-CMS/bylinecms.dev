/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchProvider } from '@byline/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { searchDocument } from '../fixtures.js'
import type { SearchConformanceHooks } from '../index.js'

export function highlightingSuite(hooks: SearchConformanceHooks): void {
  let provider: SearchProvider

  describe.sequential('SearchProvider highlighting', () => {
    beforeEach(async () => {
      await hooks.reset()
      provider = await hooks.createProvider()
    })

    it('returns marked original-text snippets when highlighting is advertised', async () => {
      await provider.upsert(
        searchDocument('Before Forest restoration <script>alert(1)</script> after.', {
          documentId: 'highlighted',
        })
      )

      const result = await provider.search({
        query: 'forest',
        collectionPath: 'search-conformance',
      })
      const highlight = result.hits[0]?.highlights?.body?.[0]

      if (!provider.capabilities.highlights) {
        expect(highlight).toBeUndefined()
        return
      }
      expect(highlight).toBe(
        'Before <mark>Forest</mark> restoration <script>alert(1)</script> after.'
      )
    })
  })
}
