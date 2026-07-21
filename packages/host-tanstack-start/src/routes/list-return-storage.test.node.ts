/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  clearListReturnState,
  persistListReturnState,
  readListReturnState,
} from './list-return-storage.js'

/** Minimal Map-backed `Storage` stand-in — node mode has no sessionStorage. */
function mockSessionStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  }
}

function stub(): void {
  ;(globalThis as { sessionStorage?: Storage }).sessionStorage = mockSessionStorage()
}

describe('list-return-storage', () => {
  afterEach(() => {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage
  })

  it('persists and reads a value keyed by collection + id', () => {
    stub()
    persistListReturnState('news', '42', 'page=6&order=title')
    expect(readListReturnState('news', '42')).toBe('page=6&order=title')
  })

  it('scopes stored state by collection + id', () => {
    stub()
    persistListReturnState('news', '42', 'page=6')
    expect(readListReturnState('news', '99')).toBeUndefined()
    expect(readListReturnState('pages', '42')).toBeUndefined()
  })

  it('clears a stored value on consume', () => {
    stub()
    persistListReturnState('news', '42', 'page=6')
    clearListReturnState('news', '42')
    expect(readListReturnState('news', '42')).toBeUndefined()
  })

  it('ignores an empty from value (nothing worth carrying)', () => {
    stub()
    persistListReturnState('news', '42', '')
    expect(readListReturnState('news', '42')).toBeUndefined()
  })

  it('degrades silently when sessionStorage is unavailable', () => {
    // No stub installed — mirrors SSR / privacy-mode contexts.
    expect(() => persistListReturnState('news', '42', 'page=6')).not.toThrow()
    expect(readListReturnState('news', '42')).toBeUndefined()
    expect(() => clearListReturnState('news', '42')).not.toThrow()
  })
})
