/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  type AdminResourceConfig,
  type CollectionAdminConfig,
  type CollectionDefinition,
  defineSingleton,
} from '../@types/index.js'
import { groupCollectionsForAdmin } from './group-collections.js'

const define = (path: string): CollectionDefinition => ({
  path,
  labels: { singular: path, plural: path },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

const pages = define('pages')
const news = define('news')
const images = define('images')
const authors = define('authors')
const categories = define('categories')
const settings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

const groups = [
  { name: 'media', label: 'Media' },
  { name: 'authorities', label: 'People & Organisations' },
  { name: 'taxonomy', label: 'Taxonomies' },
]

const admin: CollectionAdminConfig[] = [
  { slug: 'images', group: 'media' },
  { slug: 'authors', group: 'authorities' },
  { slug: 'categories', group: 'taxonomy' },
]

describe('groupCollectionsForAdmin', () => {
  it('returns one ungrouped bucket when no registry is declared', () => {
    const result = groupCollectionsForAdmin([pages, news], admin, undefined)
    expect(result).toEqual([{ name: null, label: null, collections: [pages, news] }])
  })

  it('returns one ungrouped bucket when the registry is empty', () => {
    const result = groupCollectionsForAdmin([pages, news], admin, [])
    expect(result).toEqual([{ name: null, label: null, collections: [pages, news] }])
  })

  it('emits the ungrouped band first, then groups in registry order', () => {
    const result = groupCollectionsForAdmin(
      [images, pages, categories, news, authors],
      admin,
      groups
    )
    expect(result.map((b) => b.name)).toEqual([null, 'media', 'authorities', 'taxonomy'])
  })

  it('omits the ungrouped bucket entirely when every collection is grouped', () => {
    const result = groupCollectionsForAdmin([images, authors, categories], admin, groups)
    expect(result.map((b) => b.name)).toEqual(['media', 'authorities', 'taxonomy'])
  })

  it('skips a declared group that has no member collections', () => {
    const result = groupCollectionsForAdmin([images, categories], admin, groups)
    expect(result.map((b) => b.name)).toEqual(['media', 'taxonomy'])
  })

  it('returns an empty array when there are no collections at all', () => {
    expect(groupCollectionsForAdmin([], admin, groups)).toEqual([])
  })

  it('carries each group label through to its bucket', () => {
    const result = groupCollectionsForAdmin([authors], admin, groups)
    expect(result[0]).toEqual({
      name: 'authorities',
      label: 'People & Organisations',
      collections: [authors],
    })
  })

  it('preserves collection declaration order within a bucket', () => {
    const more = define('videos')
    const result = groupCollectionsForAdmin(
      [more, images],
      [...admin, { slug: 'videos', group: 'media' }],
      groups
    )
    expect(result[0]?.collections).toEqual([more, images])
  })

  it('groups singleton and multi-collection resources together in declaration order', () => {
    const resourceAdmin: AdminResourceConfig[] = [
      ...admin,
      { singleton: true, slug: settings.path, group: 'media' },
    ]
    const result = groupCollectionsForAdmin([images, settings], resourceAdmin, groups)

    expect(result[0]?.collections).toEqual([images, settings])
  })

  it('places a collection with no admin config in the ungrouped band', () => {
    const result = groupCollectionsForAdmin([pages, images], admin, groups)
    expect(result[0]).toEqual({ name: null, label: null, collections: [pages] })
  })

  it('treats an undeclared group name as ungrouped rather than throwing', () => {
    // Boot validation rejects this configuration, but the function stays total
    // so a renderer can never crash on a stale or hand-built config object.
    const result = groupCollectionsForAdmin([pages], [{ slug: 'pages', group: 'ghost' }], groups)
    expect(result).toEqual([{ name: null, label: null, collections: [pages] }])
  })

  it('ignores admin configs whose collection is not registered', () => {
    const result = groupCollectionsForAdmin([pages], admin, groups)
    expect(result).toEqual([{ name: null, label: null, collections: [pages] }])
  })
})
