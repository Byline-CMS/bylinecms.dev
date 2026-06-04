/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { defineHooks, resolveHooks, resolveUploadHooks } from './collection-types.js'
import type {
  CollectionDefinition,
  CollectionHooks,
  CollectionHooksLoader,
  UploadHooks,
  UploadHooksLoader,
} from './collection-types.js'

function baseCollection(): CollectionDefinition {
  return {
    path: 'docs',
    labels: { singular: 'Doc', plural: 'Docs' },
    fields: [{ name: 'title', type: 'text' }],
  }
}

describe('resolveHooks', () => {
  it('returns undefined when no hooks are declared', async () => {
    const def = baseCollection()
    expect(await resolveHooks(def)).toBeUndefined()
  })

  it('returns the inline-object form as-is', async () => {
    const hooks: CollectionHooks = { afterCreate: () => {} }
    const def: CollectionDefinition = { ...baseCollection(), hooks }
    expect(await resolveHooks(def)).toBe(hooks)
  })

  it('invokes a loader returning a bare CollectionHooks object', async () => {
    const hooks: CollectionHooks = { afterCreate: () => {} }
    const def: CollectionDefinition = {
      ...baseCollection(),
      hooks: () => Promise.resolve(hooks),
    }
    expect(await resolveHooks(def)).toBe(hooks)
  })

  it('unwraps a loader returning a module namespace with a default export', async () => {
    const hooks: CollectionHooks = { afterCreate: () => {} }
    const def: CollectionDefinition = {
      ...baseCollection(),
      // Mirrors `() => import('./docs.hooks.js')` against `export default …`.
      hooks: () => Promise.resolve({ default: hooks }),
    }
    expect(await resolveHooks(def)).toBe(hooks)
  })

  it('invokes the loader at most once and memoizes the result', async () => {
    const hooks: CollectionHooks = { afterCreate: () => {} }
    const loader = vi.fn<CollectionHooksLoader>(() => Promise.resolve({ default: hooks }))
    const def: CollectionDefinition = { ...baseCollection(), hooks: loader }

    const first = await resolveHooks(def)
    const second = await resolveHooks(def)

    expect(first).toBe(hooks)
    expect(second).toBe(hooks)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('caches per loader identity — distinct loaders each run once', async () => {
    const a: CollectionHooks = { afterCreate: () => {} }
    const b: CollectionHooks = { afterUpdate: () => {} }
    const loaderA = vi.fn<CollectionHooksLoader>(() => Promise.resolve(a))
    const loaderB = vi.fn<CollectionHooksLoader>(() => Promise.resolve(b))

    expect(await resolveHooks({ ...baseCollection(), hooks: loaderA })).toBe(a)
    expect(await resolveHooks({ ...baseCollection(), hooks: loaderB })).toBe(b)
    expect(await resolveHooks({ ...baseCollection(), hooks: loaderA })).toBe(a)

    expect(loaderA).toHaveBeenCalledTimes(1)
    expect(loaderB).toHaveBeenCalledTimes(1)
  })
})

describe('resolveUploadHooks', () => {
  it('returns undefined when no upload hooks are declared', async () => {
    expect(await resolveUploadHooks(undefined)).toBeUndefined()
  })

  it('returns the inline-object form as-is', async () => {
    const hooks: UploadHooks = { afterStore: () => {} }
    expect(await resolveUploadHooks(hooks)).toBe(hooks)
  })

  it('invokes a loader returning a bare UploadHooks object', async () => {
    const hooks: UploadHooks = { beforeStore: () => {} }
    expect(await resolveUploadHooks(() => Promise.resolve(hooks))).toBe(hooks)
  })

  it('unwraps a loader returning a module namespace with a default export', async () => {
    const hooks: UploadHooks = { afterStore: () => {} }
    // Mirrors `() => import('./media.hooks.js')` against `export default …`.
    expect(await resolveUploadHooks(() => Promise.resolve({ default: hooks }))).toBe(hooks)
  })

  it('invokes the loader at most once and memoizes the result', async () => {
    const hooks: UploadHooks = { afterStore: () => {} }
    const loader = vi.fn<UploadHooksLoader>(() => Promise.resolve({ default: hooks }))

    const first = await resolveUploadHooks(loader)
    const second = await resolveUploadHooks(loader)

    expect(first).toBe(hooks)
    expect(second).toBe(hooks)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})

describe('defineHooks', () => {
  it('returns the hooks object unchanged (identity factory)', () => {
    const hooks: CollectionHooks = { afterCreate: () => {} }
    expect(defineHooks(hooks)).toBe(hooks)
  })

  it('produces a value a loader can resolve through', async () => {
    const hooks = defineHooks({ beforeCreate: () => {} })
    const def: CollectionDefinition = {
      ...baseCollection(),
      hooks: () => Promise.resolve({ default: hooks }),
    }
    expect(await resolveHooks(def)).toBe(hooks)
  })
})
