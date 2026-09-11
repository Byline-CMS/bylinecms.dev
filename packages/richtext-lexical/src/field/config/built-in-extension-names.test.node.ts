/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  builtInExtensions,
  bylineExtensionNames,
  upstreamExtensionNames,
} from './built-in-extension-names'

/**
 * Node-safe self-consistency checks for the `builtInExtensions` name map.
 *
 * The map deliberately carries strings only (no extension imports), so
 * this test cannot diff against the live `defineExtension({ name })`
 * values without dragging the React-heavy editor graph into a node test.
 * Instead it guards the map's own integrity — the naming convention,
 * uniqueness, and that each key matches the suffix of its value. Each
 * value must still mirror the corresponding extension's `name`; that
 * mirror is asserted by the editor's jsdom coverage, not here.
 *
 * The convention applies to the names Byline owns. `upstreamExtensionNames`
 * is a documented exception: those extensions ship from `@lexical/list`,
 * so Byline cannot namespace them and only guarantees that they are
 * well-formed and unique.
 */
describe('builtInExtensions name map', () => {
  const bylineEntries = Object.entries(bylineExtensionNames)
  const entries = Object.entries(builtInExtensions)

  it('namespaces every Byline-owned value under @byline/richtext-lexical/', () => {
    for (const [, value] of bylineEntries) {
      expect(value).toMatch(/^@byline\/richtext-lexical\/[A-Za-z]+$/)
    }
  })

  it('names each Byline-owned key after the suffix of its value', () => {
    for (const [key, value] of bylineEntries) {
      expect(value).toBe(`@byline/richtext-lexical/${key}`)
    }
  })

  it('keeps upstream-owned values well-formed and namespaced to their package', () => {
    for (const [, value] of Object.entries(upstreamExtensionNames)) {
      expect(value).toMatch(/^@lexical\/[a-z-]+\/[A-Za-z]+$/)
    }
  })

  it('exposes both groups through the merged map', () => {
    for (const key of [
      ...Object.keys(bylineExtensionNames),
      ...Object.keys(upstreamExtensionNames),
    ]) {
      expect(builtInExtensions).toHaveProperty(key)
    }
  })

  it('uses each value exactly once across the merged map', () => {
    const values = entries.map(([, value]) => value)
    expect(new Set(values).size).toBe(values.length)
  })
})
