/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defineCollection, defineSingleton, isSingleton } from './collection-types.js'

describe('defineSingleton', () => {
  it('stamps the singleton discriminant', () => {
    const def = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
    expect(def.singleton).toBe(true)
    expect(def.path).toBe('site-settings')
  })

  it('narrows through isSingleton', () => {
    const singleton = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
    const collection = defineCollection({
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    })
    expect(isSingleton(singleton)).toBe(true)
    expect(isSingleton(collection)).toBe(false)
  })

  it('rejects a collection-only option at the definition site', () => {
    defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      // @ts-expect-error — `orderable` is `?: never` on SingletonDefinition.
      // The directive suppresses only the NEXT line, so it must sit here and
      // not above `defineSingleton(`. If it ever stops erroring, the union has
      // gone soft and runtime validation is all that is left.
      orderable: true,
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
  })

  it('keeps collection and singleton hook families disjoint at the definition site', () => {
    defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
      hooks: {
        // @ts-expect-error — collection create hooks do not exist on a singleton.
        beforeCreate: () => {},
      },
    })

    defineCollection({
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
      hooks: {
        // @ts-expect-error — singleton save hooks do not exist on a collection.
        beforeSave: () => {},
      },
    })
  })

  it('preserves literal path types for the generated registries', () => {
    const def = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
    const path: 'site-settings' = def.path
    expect(path).toBe('site-settings')
  })
})
