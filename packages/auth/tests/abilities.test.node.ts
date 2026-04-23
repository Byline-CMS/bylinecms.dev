/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { AbilityRegistry } from '../src/abilities.js'

describe('AbilityRegistry', () => {
  describe('register / has / get', () => {
    it('registers a new descriptor and reports it via has/get', () => {
      const registry = new AbilityRegistry()
      registry.register({
        key: 'collections.pages.read',
        label: 'Read Pages',
        group: 'collections.pages',
        source: 'collection',
      })
      expect(registry.has('collections.pages.read')).toBe(true)
      const got = registry.get('collections.pages.read')
      expect(got).toMatchObject({
        key: 'collections.pages.read',
        label: 'Read Pages',
        group: 'collections.pages',
        source: 'collection',
      })
    })

    it('returns undefined for unknown keys', () => {
      const registry = new AbilityRegistry()
      expect(registry.has('nope')).toBe(false)
      expect(registry.get('nope')).toBeUndefined()
    })

    it('returns a copy from get() (caller mutation does not affect registry)', () => {
      const registry = new AbilityRegistry()
      registry.register({ key: 'a', label: 'A', group: 'g' })
      const first = registry.get('a')
      if (first) first.label = 'MUTATED'
      expect(registry.get('a')?.label).toBe('A')
    })
  })

  describe('duplicate registration', () => {
    it('is a silent no-op when the same key is registered twice', () => {
      const registry = new AbilityRegistry()
      registry.register({ key: 'a', label: 'First', group: 'g' })
      registry.register({ key: 'a', label: 'Second', group: 'g-other' })
      expect(registry.size).toBe(1)
      // First-writer wins — the second registration is ignored.
      expect(registry.get('a')?.label).toBe('First')
    })
  })

  describe('list', () => {
    it('returns descriptors in insertion order', () => {
      const registry = new AbilityRegistry()
      registry.register({ key: 'b', label: 'B', group: 'g' })
      registry.register({ key: 'a', label: 'A', group: 'g' })
      registry.register({ key: 'c', label: 'C', group: 'g' })
      const keys = registry.list().map((d) => d.key)
      expect(keys).toEqual(['b', 'a', 'c'])
    })

    it('returns copies — caller mutation does not affect registry', () => {
      const registry = new AbilityRegistry()
      registry.register({ key: 'a', label: 'A', group: 'g' })
      const list = registry.list()
      const first = list[0]
      if (first) first.label = 'MUTATED'
      expect(registry.get('a')?.label).toBe('A')
    })
  })

  describe('byGroup', () => {
    it('groups descriptors by their `group` key', () => {
      const registry = new AbilityRegistry()
      registry.register({
        key: 'collections.pages.read',
        label: 'Read Pages',
        group: 'collections.pages',
      })
      registry.register({
        key: 'collections.pages.create',
        label: 'Create Page',
        group: 'collections.pages',
      })
      registry.register({ key: 'media.manage', label: 'Manage Media', group: 'media' })
      const buckets = registry.byGroup()
      expect(buckets.size).toBe(2)
      expect(buckets.get('collections.pages')?.map((d) => d.key)).toEqual([
        'collections.pages.read',
        'collections.pages.create',
      ])
      expect(buckets.get('media')?.map((d) => d.key)).toEqual(['media.manage'])
    })

    it('returns an empty Map when nothing is registered', () => {
      const registry = new AbilityRegistry()
      expect(registry.byGroup().size).toBe(0)
    })
  })

  describe('size / clear', () => {
    it('size reports the number of registered abilities', () => {
      const registry = new AbilityRegistry()
      expect(registry.size).toBe(0)
      registry.register({ key: 'a', label: 'A', group: 'g' })
      registry.register({ key: 'b', label: 'B', group: 'g' })
      expect(registry.size).toBe(2)
    })

    it('clear drops every registered ability', () => {
      const registry = new AbilityRegistry()
      registry.register({ key: 'a', label: 'A', group: 'g' })
      registry.register({ key: 'b', label: 'B', group: 'g' })
      registry.clear()
      expect(registry.size).toBe(0)
      expect(registry.has('a')).toBe(false)
      expect(registry.list()).toEqual([])
    })
  })
})
