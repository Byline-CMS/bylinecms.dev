/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateTag: vi.fn(),
}))

vi.mock('@/config', () => ({
  getServerConfig: () => ({ cache: { dataRequests: false } }),
}))
vi.mock('./index', () => ({
  getCache: vi.fn(),
  invalidateTag: mocks.invalidateTag,
}))

import { invalidateDocument, tags } from './with-cache.js'

describe('invalidateDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invalidateTag.mockResolvedValue(undefined)
  })

  it('attempts every requested cache surface and aggregates failures', async () => {
    const detailFailure = new Error('detail cache failed')
    mocks.invalidateTag.mockRejectedValueOnce(detailFailure)

    let caught: unknown
    try {
      await invalidateDocument('news', 'new-path', {
        prevPath: 'old-path',
        list: true,
        sitemap: true,
      })
    } catch (error) {
      caught = error
    }

    expect(mocks.invalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      tags.details('news', 'new-path'),
      tags.details('news', 'old-path'),
      tags.list('news'),
      tags.sitemap('news'),
    ])
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([detailFailure])
  })
})
