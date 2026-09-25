/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveLocaleFromLedger } from './locale-resolution.js'

describe('resolveLocaleFromLedger', () => {
  it('returns the requested locale when the ledger records it as complete', () => {
    expect(
      resolveLocaleFromLedger(['de', 'en'], {
        availableLocales: ['en', 'de'],
        localeAgnostic: false,
      })
    ).toBe('de')
  })

  it('falls back to the floor when the requested locale is not complete', () => {
    expect(
      resolveLocaleFromLedger(['de', 'en'], { availableLocales: ['en'], localeAgnostic: false })
    ).toBe('en')
  })

  it('returns the floor even when the ledger does not list it', () => {
    // The floor is terminal: fallback never 404s on a missing translation.
    expect(
      resolveLocaleFromLedger(['de', 'fr'], { availableLocales: ['en'], localeAgnostic: false })
    ).toBe('fr')
  })

  it('returns the requested locale for a locale-agnostic version', () => {
    expect(
      resolveLocaleFromLedger(['de', 'en'], { availableLocales: [], localeAgnostic: true })
    ).toBe('de')
  })

  it('resolves a single-entry chain to that entry', () => {
    expect(
      resolveLocaleFromLedger(['en'], { availableLocales: ['en'], localeAgnostic: false })
    ).toBe('en')
  })

  it('walks an intermediate candidate before the floor', () => {
    const ledger = { availableLocales: ['es', 'en'], localeAgnostic: false }
    expect(resolveLocaleFromLedger(['es-MX', 'es', 'en'], ledger)).toBe('es')
  })

  it('returns undefined without a ledger so the caller can derive from rows', () => {
    expect(resolveLocaleFromLedger(['de', 'en'], undefined)).toBeUndefined()
  })
})
