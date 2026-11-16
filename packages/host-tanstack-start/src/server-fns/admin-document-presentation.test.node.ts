/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { resolveAdminDocumentRead } from './admin-document-presentation.js'

const media = {
  path: 'media',
  labels: { singular: 'Media', plural: 'Media' },
  useAsTitle: 'title',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'image', type: 'image' },
  ],
} as unknown as CollectionDefinition

const bio = {
  path: 'bios',
  labels: { singular: 'Bio', plural: 'Bios' },
  fields: [
    { name: 'name', type: 'text' },
    { name: 'photo', type: 'relation', targetCollection: 'media' },
  ],
} as unknown as CollectionDefinition

// The server runtime state behind the bug: the server schema is registered,
// but the admin config is not, because no admin route has rendered here yet.
vi.mock('@byline/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@byline/core')>()),
  getCollectionDefinition: (path: string) => (path === 'media' ? media : null),
  getCollectionAdminConfig: () => null,
}))

describe('resolveAdminDocumentRead without a registered admin config', () => {
  it('drops item-view fields when the loader sends no projections', () => {
    const { options } = resolveAdminDocumentRead(bio, { populateRelations: true })
    expect(options.populate).toEqual({ photo: { select: ['title'] } })
  })

  it('keeps the loader-sent projection so the media thumbnail is fetched', () => {
    const { options, populatedTree } = resolveAdminDocumentRead(bio, {
      populateRelations: true,
      relationProjections: { photo: ['title', 'image'] },
    })
    expect(options.populate).toEqual({ photo: { select: ['title', 'image'] } })
    expect(options.depth).toBe(1)
    expect(populatedTree).toBe(true)
  })

  it('leaves the explicit-depth preview mode unchanged', () => {
    const { options } = resolveAdminDocumentRead(bio, {
      depth: 2,
      relationProjections: { photo: ['image'] },
    })
    expect(options.populate).toBe('*')
    expect(options.depth).toBe(2)
  })
})
