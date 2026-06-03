/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { builtInExtensions } from './built-in-extension-names'

/**
 * Node-safe self-consistency checks for the `builtInExtensions` name map.
 *
 * The map deliberately carries strings only (no extension imports), so
 * this test cannot diff against the live `defineExtension({ name })`
 * values without dragging the React-heavy editor graph into a node test.
 * Instead it guards the map's own integrity — the `@byline/richtext-lexical/*`
 * convention, uniqueness, and that each key matches the suffix of its
 * value. Each value must still mirror the corresponding extension's
 * `name`; that mirror is asserted by the editor's jsdom/integration
 * coverage, not here.
 */
describe('builtInExtensions name map', () => {
  const entries = Object.entries(builtInExtensions)

  it('namespaces every value under @byline/richtext-lexical/', () => {
    for (const [, value] of entries) {
      expect(value).toMatch(/^@byline\/richtext-lexical\/[A-Za-z]+$/)
    }
  })

  it('uses each value exactly once', () => {
    const values = entries.map(([, value]) => value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('names each key after the suffix of its value', () => {
    for (const [key, value] of entries) {
      expect(value).toBe(`@byline/richtext-lexical/${key}`)
    }
  })
})
