/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AbilityRegistry } from '@byline/auth'
import { describe, expect, it } from 'vitest'

import {
  COLLECTION_ABILITY_VERBS,
  collectionAbilityKey,
  registerCollectionAbilities,
} from './register-collection-abilities.js'
import type { CollectionDefinition } from '../@types/index.js'

function pageCollection(): CollectionDefinition {
  return {
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    fields: [{ name: 'title', type: 'text' }],
  }
}

function newsCollection(): CollectionDefinition {
  return {
    path: 'news',
    labels: { singular: 'News Item', plural: 'News' },
    fields: [{ name: 'title', type: 'text' }],
    workflow: {
      statuses: [
        { name: 'draft' },
        { name: 'in_review' },
        { name: 'published' },
        { name: 'archived' },
      ],
    },
  }
}

describe('registerCollectionAbilities', () => {
  it('registers exactly the six CRUD + workflow abilities for a collection', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())

    const keys = registry.list().map((d) => d.key)
    expect(keys).toEqual([
      'collections.pages.read',
      'collections.pages.create',
      'collections.pages.update',
      'collections.pages.delete',
      'collections.pages.publish',
      'collections.pages.changeStatus',
    ])
  })

  it('places every ability under the same `collections.<path>` group', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    const buckets = registry.byGroup()
    expect(buckets.size).toBe(1)
    expect(buckets.get('collections.pages')?.length).toBe(6)
  })

  it('derives labels from the collection singular/plural labels', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    expect(registry.get('collections.pages.read')?.label).toBe('Read Pages')
    expect(registry.get('collections.pages.create')?.label).toBe('Create Page')
    expect(registry.get('collections.pages.update')?.label).toBe('Update Page')
    expect(registry.get('collections.pages.delete')?.label).toBe('Delete Page')
    expect(registry.get('collections.pages.publish')?.label).toBe('Publish Pages')
    expect(registry.get('collections.pages.changeStatus')?.label).toBe('Change status of Pages')
  })

  it('tags every ability with source: "collection"', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    for (const descriptor of registry.list()) {
      expect(descriptor.source).toBe('collection')
    }
  })

  it('registers the same six-ability shape regardless of workflow complexity', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, newsCollection())
    expect(registry.list().map((d) => d.key)).toEqual([
      'collections.news.read',
      'collections.news.create',
      'collections.news.update',
      'collections.news.delete',
      'collections.news.publish',
      'collections.news.changeStatus',
    ])
  })

  it('is idempotent — calling twice leaves the registry with the same six entries', () => {
    const registry = new AbilityRegistry()
    const collection = pageCollection()
    registerCollectionAbilities(registry, collection)
    registerCollectionAbilities(registry, collection)
    expect(registry.size).toBe(6)
  })

  it('keeps multiple collections isolated in distinct groups', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    registerCollectionAbilities(registry, newsCollection())
    const buckets = registry.byGroup()
    expect(buckets.size).toBe(2)
    expect(buckets.get('collections.pages')?.length).toBe(6)
    expect(buckets.get('collections.news')?.length).toBe(6)
    expect(registry.size).toBe(12)
  })
})

describe('COLLECTION_ABILITY_VERBS / collectionAbilityKey', () => {
  it('COLLECTION_ABILITY_VERBS exposes the canonical verb list in registration order', () => {
    expect(COLLECTION_ABILITY_VERBS).toEqual([
      'read',
      'create',
      'update',
      'delete',
      'publish',
      'changeStatus',
    ])
  })

  it('collectionAbilityKey composes a flat dotted key', () => {
    expect(collectionAbilityKey('pages', 'publish')).toBe('collections.pages.publish')
    expect(collectionAbilityKey('news', 'changeStatus')).toBe('collections.news.changeStatus')
  })

  it('matches the keys produced by registerCollectionAbilities', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    for (const verb of COLLECTION_ABILITY_VERBS) {
      expect(registry.has(collectionAbilityKey('pages', verb))).toBe(true)
    }
  })
})
