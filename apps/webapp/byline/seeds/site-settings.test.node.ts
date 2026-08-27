/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), singleton: vi.fn() }))

vi.mock('@byline/client/server', () => ({
  getSystemBylineClient: () => ({ singleton: mocks.singleton }),
}))

import { seedSiteSettings } from './site-settings.js'

describe('seedSiteSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.singleton.mockReturnValue({ get: mocks.get, update: mocks.update })
    mocks.update.mockResolvedValue({
      documentId: 'document-settings',
      documentVersionId: 'version-settings',
    })
  })

  it('materializes the empty slot only once when the seed is rerun', async () => {
    mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'document-settings',
      versionId: 'version-settings',
      status: 'published',
      fields: { siteName: 'Example site' },
    })

    await expect(seedSiteSettings()).resolves.toBe('seeded')
    await expect(seedSiteSettings()).resolves.toBe('unchanged')

    expect(mocks.singleton).toHaveBeenCalledTimes(2)
    expect(mocks.singleton).toHaveBeenNthCalledWith(1, 'site-settings')
    expect(mocks.singleton).toHaveBeenNthCalledWith(2, 'site-settings')
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(mocks.get).toHaveBeenNthCalledWith(1, { status: 'any' })
    expect(mocks.get).toHaveBeenNthCalledWith(2, { status: 'any' })
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith({
      siteName: 'Example site',
      siteDescription:
        'A concise description of this site for search results and social media previews.',
    })
  })

  it('does not overwrite an existing slot or mint another version', async () => {
    mocks.get.mockResolvedValue({
      id: 'document-settings',
      versionId: 'editor-version',
      status: 'published',
      fields: { siteName: 'Editor value', siteDescription: 'Editor-owned description.' },
    })

    await expect(seedSiteSettings()).resolves.toBe('unchanged')

    expect(mocks.update).not.toHaveBeenCalled()
  })
})
