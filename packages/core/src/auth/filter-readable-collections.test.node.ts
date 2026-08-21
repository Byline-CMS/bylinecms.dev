/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { filterReadableCollections } from './filter-readable-collections.js'
import type { CollectionDefinition } from '../@types/index.js'

const define = (path: string): CollectionDefinition => ({
  path,
  labels: { singular: path, plural: path },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

const news = define('news')
const pages = define('pages')
const media = define('media')
const all = [news, pages, media]

describe('filterReadableCollections', () => {
  it('returns every collection for a super admin, regardless of abilities', () => {
    expect(filterReadableCollections(all, { isSuperAdmin: true, abilities: [] })).toEqual(all)
  })

  it('returns nothing when the actor holds no abilities', () => {
    expect(filterReadableCollections(all, { isSuperAdmin: false, abilities: [] })).toEqual([])
  })

  it('returns only the collections whose read ability is held', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: ['collections.news.read', 'collections.media.read'],
    })
    expect(result).toEqual([news, media])
  })

  it('preserves declaration order', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: ['collections.media.read', 'collections.news.read'],
    })
    expect(result.map((c) => c.path)).toEqual(['news', 'media'])
  })

  it('does not treat a non-read verb as granting visibility', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: [
        'collections.news.create',
        'collections.news.update',
        'collections.news.publish',
        'collections.news.delete',
        'collections.news.changeStatus',
        'collections.news.reindex',
      ],
    })
    expect(result).toEqual([])
  })

  it('does not match on a prefix of a collection path', () => {
    const result = filterReadableCollections([define('news-categories')], {
      isSuperAdmin: false,
      abilities: ['collections.news.read'],
    })
    expect(result).toEqual([])
  })

  it('ignores unrelated admin abilities', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: ['admin.users.read', 'admin.roles.read'],
    })
    expect(result).toEqual([])
  })

  it('returns a new array rather than the input', () => {
    const result = filterReadableCollections(all, { isSuperAdmin: true, abilities: [] })
    expect(result).not.toBe(all)
  })
})
