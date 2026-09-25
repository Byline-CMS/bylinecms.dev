/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  deriveVersionLocaleLedger,
  type LocaleEligibility,
  resolveLocaleVisibility,
  resolveReadLocale,
} from './locale-resolution.js'
import type { FlattenedFieldValue } from './storage-row-types.js'

// The eligibility rule and the fallback walk are private to the module; these
// helpers observe them through `resolveReadLocale`, the only adapter-facing
// entry point. A locale is eligible exactly when a fallback read toward the
// source selects it, and the walk's result is the locale that read restores.
function isLocaleEligible(locale: string, eligibility: LocaleEligibility): boolean {
  const chain = locale === eligibility.sourceLocale ? [locale] : [locale, eligibility.sourceLocale]
  return (
    resolveReadLocale({ locale, chain, onMissingLocale: 'fallback', eligibility }).restoreLocale ===
    locale
  )
}

function resolveEligibleLocale(chain: string[], eligibility: LocaleEligibility): string {
  const decision = resolveReadLocale({
    locale: chain[0] as string,
    chain,
    onMissingLocale: 'fallback',
    eligibility,
  })
  return decision.restoreLocale as string
}

describe('deriveVersionLocaleLedger', () => {
  const row = (locale: string, path: string, field_type = 'text') =>
    ({ locale, field_path: path.split('.'), field_type }) as unknown as FlattenedFieldValue

  it('records the locales that cover every source-locale localized path', () => {
    const ledger = deriveVersionLocaleLedger(
      [
        row('en', 'title'),
        row('en', 'body'),
        row('de', 'title'),
        row('de', 'body'),
        row('fr', 'title'),
        row('all', 'sku'),
        row('all', 'content.0', 'meta'),
      ],
      'en'
    )
    expect(ledger).toEqual({ availableLocales: ['en', 'de'], localeAgnostic: false })
  })

  it('marks a version with no localized rows as locale-agnostic', () => {
    expect(deriveVersionLocaleLedger([row('all', 'sku')], 'en')).toEqual({
      availableLocales: [],
      localeAgnostic: true,
    })
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

describe('resolveReadLocale — the seven resolvedLocale result types', () => {
  const eligibility = (overrides: Partial<LocaleEligibility> = {}): LocaleEligibility => ({
    visibility: 'public',
    sourceLocale: 'en',
    // Spanish complete but unchecked; German partial (not in the ledger).
    ledger: { availableLocales: ['en', 'es'], localeAgnostic: false },
    advertiseLocales: true,
    availableLocales: [],
    ...overrides,
  })
  const chain = (locale: string) => (locale === 'en' ? ['en'] : [locale, 'en'])

  it('R1: fallback reports the selected permitted locale, including the source', () => {
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'fallback',
        eligibility: eligibility({ availableLocales: ['es'] }),
      })
    ).toEqual({ restoreLocale: 'es', resolvedLocale: 'es', withholdLocalized: false })
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'fallback',
        eligibility: eligibility(),
      })
    ).toEqual({ restoreLocale: 'en', resolvedLocale: 'en', withholdLocalized: false })
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'fallback',
        eligibility: eligibility({ visibility: 'editorial' }),
      })
    ).toEqual({ restoreLocale: 'es', resolvedLocale: 'es', withholdLocalized: false })
  })

  it('R2: omit reports the requested locale', () => {
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'omit',
        eligibility: eligibility({ availableLocales: ['es'] }),
      })
    ).toEqual({ restoreLocale: 'es', resolvedLocale: 'es', withholdLocalized: false })
  })

  it('R3: public empty with an eligible locale reports it, with no fallback', () => {
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'empty',
        eligibility: eligibility({ availableLocales: ['es'] }),
      })
    ).toEqual({ restoreLocale: 'es', resolvedLocale: 'es', withholdLocalized: false })
  })

  it('R4: public empty with an unavailable translation withholds values and reports null', () => {
    // Complete but unchecked.
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'empty',
        eligibility: eligibility(),
      })
    ).toEqual({ restoreLocale: 'es', resolvedLocale: null, withholdLocalized: true })
    // Checked but incomplete.
    expect(
      resolveReadLocale({
        locale: 'de',
        chain: chain('de'),
        onMissingLocale: 'empty',
        eligibility: eligibility({ availableLocales: ['de'] }),
      })
    ).toEqual({ restoreLocale: 'de', resolvedLocale: null, withholdLocalized: true })
    // An omitted policy is exact, like empty.
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: undefined,
        eligibility: eligibility(),
      }).withholdLocalized
    ).toBe(true)
  })

  it('R4: public empty still serves the source even when its checkbox is off', () => {
    expect(
      resolveReadLocale({
        locale: 'en',
        chain: chain('en'),
        onMissingLocale: 'empty',
        eligibility: eligibility(),
      })
    ).toEqual({ restoreLocale: 'en', resolvedLocale: 'en', withholdLocalized: false })
  })

  it('R5: editorial empty reports the requested locale even when partial', () => {
    expect(
      resolveReadLocale({
        locale: 'de',
        chain: chain('de'),
        onMissingLocale: 'empty',
        eligibility: eligibility({ visibility: 'editorial' }),
      })
    ).toEqual({ restoreLocale: 'de', resolvedLocale: 'de', withholdLocalized: false })
  })

  it('R6: a multi-locale read reports null and restores locale maps', () => {
    expect(
      resolveReadLocale({
        locale: 'all',
        chain: ['all'],
        onMissingLocale: 'empty',
        eligibility: eligibility({ visibility: 'editorial' }),
      })
    ).toEqual({ restoreLocale: undefined, resolvedLocale: null, withholdLocalized: false })
  })

  it('R7: a locale-agnostic version reports null under every policy', () => {
    const agnostic = eligibility({ ledger: { availableLocales: [], localeAgnostic: true } })
    for (const onMissingLocale of ['fallback', 'omit', 'empty', undefined] as const) {
      expect(
        resolveReadLocale({
          locale: 'es',
          chain: chain('es'),
          onMissingLocale,
          eligibility: agnostic,
        })
      ).toEqual({ restoreLocale: 'es', resolvedLocale: null, withholdLocalized: false })
    }
  })

  it('a non-advertised collection withholds an incomplete translation publicly', () => {
    expect(
      resolveReadLocale({
        locale: 'de',
        chain: chain('de'),
        onMissingLocale: 'empty',
        eligibility: eligibility({ advertiseLocales: false }),
      }).withholdLocalized
    ).toBe(true)
    expect(
      resolveReadLocale({
        locale: 'es',
        chain: chain('es'),
        onMissingLocale: 'empty',
        eligibility: eligibility({ advertiseLocales: false }),
      })
    ).toEqual({ restoreLocale: 'es', resolvedLocale: 'es', withholdLocalized: false })
  })
})
