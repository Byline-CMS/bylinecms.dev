/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  isLocaleEligible,
  type LocaleEligibility,
  resolveEligibleLocale,
  resolveLocaleFromLedger,
  resolveLocaleVisibility,
} from './locale-resolution.js'

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

describe('isLocaleEligible', () => {
  const base: LocaleEligibility = {
    visibility: 'public',
    sourceLocale: 'en',
    ledger: { availableLocales: ['en', 'es', 'de'], localeAgnostic: false },
    advertiseLocales: true,
    availableLocales: ['de'],
  }

  it('public: a complete and checked translation is eligible', () => {
    expect(isLocaleEligible('de', base)).toBe(true)
  })

  it('public: a complete but unchecked translation is not eligible', () => {
    expect(isLocaleEligible('es', base)).toBe(false)
  })

  it('public: a checked but incomplete translation is not eligible', () => {
    expect(isLocaleEligible('fr', { ...base, availableLocales: ['fr'] })).toBe(false)
  })

  it('public: the source is eligible even when its checkbox is off', () => {
    expect(isLocaleEligible('en', { ...base, availableLocales: [] })).toBe(true)
  })

  it('public: an empty advertised set authorizes no additional translation', () => {
    expect(isLocaleEligible('de', { ...base, availableLocales: [] })).toBe(false)
  })

  it('public: a collection without advertiseLocales is gated by completeness alone', () => {
    const optOut = { ...base, advertiseLocales: false, availableLocales: [] }
    expect(isLocaleEligible('es', optOut)).toBe(true)
    expect(isLocaleEligible('fr', optOut)).toBe(false)
  })

  it('a locale-agnostic version is eligible in every locale', () => {
    const agnostic = { ...base, ledger: { availableLocales: [], localeAgnostic: true } }
    expect(isLocaleEligible('fr', agnostic)).toBe(true)
  })

  it('editorial: a complete but unchecked translation is eligible', () => {
    expect(isLocaleEligible('es', { ...base, visibility: 'editorial' })).toBe(true)
  })

  it('editorial: completeness is still required', () => {
    expect(isLocaleEligible('fr', { ...base, visibility: 'editorial' })).toBe(false)
  })
})

describe('resolveEligibleLocale', () => {
  const base: LocaleEligibility = {
    visibility: 'public',
    sourceLocale: 'en',
    ledger: { availableLocales: ['en', 'es', 'es-MX'], localeAgnostic: false },
    advertiseLocales: true,
    availableLocales: [],
  }

  it('public: an unchecked translation falls back to the source', () => {
    expect(resolveEligibleLocale(['es', 'en'], base)).toBe('en')
  })

  it('editorial: the same unchecked translation is selected', () => {
    expect(resolveEligibleLocale(['es', 'en'], { ...base, visibility: 'editorial' })).toBe('es')
  })

  it('public: a withheld intermediate candidate is skipped', () => {
    // Named fallback chains are not configurable yet; this pins that every
    // candidate must satisfy the policy if they are added later.
    const eligibility = { ...base, availableLocales: ['es'] }
    expect(resolveEligibleLocale(['es-MX', 'es', 'en'], eligibility)).toBe('es')
    expect(resolveEligibleLocale(['es-MX', 'es', 'en'], base)).toBe('en')
  })

  it('returns the floor when nothing earlier qualifies', () => {
    expect(resolveEligibleLocale(['fr', 'en'], base)).toBe('en')
  })
})

describe('resolveLocaleVisibility', () => {
  it('defaults to public for an omitted or published status', () => {
    expect(resolveLocaleVisibility(undefined)).toBe('public')
    expect(resolveLocaleVisibility('published')).toBe('public')
  })

  it('defaults to editorial for status any', () => {
    expect(resolveLocaleVisibility('any')).toBe('editorial')
  })

  it('an explicit value wins over the status default', () => {
    expect(resolveLocaleVisibility('published', 'editorial')).toBe('editorial')
    expect(resolveLocaleVisibility('any', 'public')).toBe('public')
  })
})
