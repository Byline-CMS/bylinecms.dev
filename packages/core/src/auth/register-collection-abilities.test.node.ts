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
  documentAbilityKey,
  registerCollectionAbilities,
  registerDocumentAbilities,
  registerSingletonAbilities,
  SINGLETON_ABILITY_VERBS,
} from './register-collection-abilities.js'
import type { MultiCollectionDefinition, SingletonDefinition } from '../@types/index.js'

function pageCollection(): MultiCollectionDefinition {
  return {
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    fields: [{ name: 'title', type: 'text' }],
  }
}

function newsCollection(): MultiCollectionDefinition {
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

function siteSettings(): SingletonDefinition {
  return {
    singleton: true,
    path: 'site-settings',
    label: 'Site settings',
    fields: [{ name: 'title', type: 'text' }],
  }
}

describe('registerCollectionAbilities', () => {
  it('registers exactly the seven collection abilities', () => {
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
      'collections.pages.reindex',
    ])
  })

  it('places every ability under the same `collections.<path>` group', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    const buckets = registry.byGroup()
    expect(buckets.size).toBe(1)
    expect(buckets.get('collections.pages')?.length).toBe(7)
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
    expect(registry.get('collections.pages.reindex')?.label).toBe('Reindex Pages search')
  })

  it('tags every ability with source: "collection"', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    for (const descriptor of registry.list()) {
      expect(descriptor.source).toBe('collection')
    }
  })

  it('registers the same seven-ability shape regardless of workflow complexity', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, newsCollection())
    expect(registry.list().map((d) => d.key)).toEqual([
      'collections.news.read',
      'collections.news.create',
      'collections.news.update',
      'collections.news.delete',
      'collections.news.publish',
      'collections.news.changeStatus',
      'collections.news.reindex',
    ])
  })

  it('is idempotent — calling twice leaves the registry with the same seven entries', () => {
    const registry = new AbilityRegistry()
    const collection = pageCollection()
    registerCollectionAbilities(registry, collection)
    registerCollectionAbilities(registry, collection)
    expect(registry.size).toBe(7)
  })

  it('keeps multiple collections isolated in distinct groups', () => {
    const registry = new AbilityRegistry()
    registerCollectionAbilities(registry, pageCollection())
    registerCollectionAbilities(registry, newsCollection())
    const buckets = registry.byGroup()
    expect(buckets.size).toBe(2)
    expect(buckets.get('collections.pages')?.length).toBe(7)
    expect(buckets.get('collections.news')?.length).toBe(7)
    expect(registry.size).toBe(14)
  })
})

describe('registerSingletonAbilities', () => {
  it('registers exactly the four singleton abilities', () => {
    const registry = new AbilityRegistry()
    registerSingletonAbilities(registry, siteSettings())

    expect(registry.list().map((descriptor) => descriptor.key)).toEqual([
      'singletons.site-settings.read',
      'singletons.site-settings.update',
      'singletons.site-settings.publish',
      'singletons.site-settings.changeStatus',
    ])
  })

  it('uses the singleton label and one singleton group', () => {
    const registry = new AbilityRegistry()
    registerSingletonAbilities(registry, siteSettings())

    expect(registry.list().map((descriptor) => descriptor.label)).toEqual([
      'Read Site settings',
      'Update Site settings',
      'Publish Site settings',
      'Change status of Site settings',
    ])
    expect(registry.byGroup().get('singletons.site-settings')).toHaveLength(4)
  })

  it('does not register collection-only verbs', () => {
    const registry = new AbilityRegistry()
    registerSingletonAbilities(registry, siteSettings())

    expect(registry.has('singletons.site-settings.create')).toBe(false)
    expect(registry.has('singletons.site-settings.delete')).toBe(false)
    expect(registry.has('singletons.site-settings.reindex')).toBe(false)
  })
})

describe('registerDocumentAbilities', () => {
  it('dispatches both definition kinds into isolated ability families', () => {
    const registry = new AbilityRegistry()
    registerDocumentAbilities(registry, pageCollection())
    registerDocumentAbilities(registry, siteSettings())

    expect(registry.size).toBe(11)
    expect(registry.byGroup().get('collections.pages')).toHaveLength(7)
    expect(registry.byGroup().get('singletons.site-settings')).toHaveLength(4)
  })
})

describe('ability verb contracts / documentAbilityKey', () => {
  it('COLLECTION_ABILITY_VERBS exposes the canonical verb list in registration order', () => {
    expect(COLLECTION_ABILITY_VERBS).toEqual([
      'read',
      'create',
      'update',
      'delete',
      'publish',
      'changeStatus',
      'reindex',
    ])
  })

  it('SINGLETON_ABILITY_VERBS exposes the canonical verb list in registration order', () => {
    expect(SINGLETON_ABILITY_VERBS).toEqual(['read', 'update', 'publish', 'changeStatus'])
  })

  it('composes a kind-aware flat dotted key from definitions and explicit descriptors', () => {
    expect(documentAbilityKey(pageCollection(), 'publish')).toBe('collections.pages.publish')
    expect(documentAbilityKey(siteSettings(), 'changeStatus')).toBe(
      'singletons.site-settings.changeStatus'
    )
    expect(documentAbilityKey({ kind: 'collection', path: 'news' }, 'read')).toBe(
      'collections.news.read'
    )
    expect(documentAbilityKey({ kind: 'singleton', path: 'navigation' }, 'update')).toBe(
      'singletons.navigation.update'
    )
  })

  it('preserves the deprecated collectionAbilityKey string-path contract', () => {
    expect(collectionAbilityKey('news', 'read')).toBe('collections.news.read')
  })

  it('matches the keys produced by registerCollectionAbilities', () => {
    const registry = new AbilityRegistry()
    const definition = pageCollection()
    registerCollectionAbilities(registry, definition)
    for (const verb of COLLECTION_ABILITY_VERBS) {
      expect(registry.has(documentAbilityKey(definition, verb))).toBe(true)
    }
  })

  it('matches the keys produced by registerSingletonAbilities', () => {
    const registry = new AbilityRegistry()
    const definition = siteSettings()
    registerSingletonAbilities(registry, definition)
    for (const verb of SINGLETON_ABILITY_VERBS) {
      expect(registry.has(documentAbilityKey(definition, verb))).toBe(true)
    }
  })

  it('rejects collection-only verbs for singleton descriptors at compile time and runtime', () => {
    const singleton = siteSettings()
    const compileOnlyInvalidCall = () => {
      documentAbilityKey(
        singleton,
        // @ts-expect-error create is not a singleton ability verb
        'create'
      )
    }
    expect(compileOnlyInvalidCall).toBeTypeOf('function')

    const untypedKey = documentAbilityKey as (resource: unknown, verb: string) => string
    expect(() => untypedKey(singleton, 'create')).toThrow(/verb 'create'.*singleton/)
    expect(() => untypedKey(singleton, 'delete')).toThrow(/verb 'delete'.*singleton/)
    expect(() => untypedKey(singleton, 'reindex')).toThrow(/verb 'reindex'.*singleton/)
  })
})
