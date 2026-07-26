/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { MAX_SEARCH_QUERY_LENGTH } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { assertSearchQueryLength } from './search.js'

describe('search query validation', () => {
  it('accepts the portable query limit and rejects longer input', () => {
    expect(() => assertSearchQueryLength('a'.repeat(MAX_SEARCH_QUERY_LENGTH))).not.toThrow()
    expect(() => assertSearchQueryLength('a'.repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toThrowError(
      expect.objectContaining({
        code: 'ERR_VALIDATION',
        details: {
          maximumLength: MAX_SEARCH_QUERY_LENGTH,
          actualLength: MAX_SEARCH_QUERY_LENGTH + 1,
        },
      })
    )
  })
})
