/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveInterfaceLocale } from './resolve.js'

const locales = ['en', 'fr', 'es']
const defaultLocale = 'en'

describe('resolveInterfaceLocale — tier 1 (preferred)', () => {
  it('wins over every other signal when set and valid', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      preferred: 'fr',
      cookie: 'es',
      acceptLanguage: 'es;q=0.9, en;q=0.8',
    })
    expect(out).toBe('fr')
  })

  it('falls through when preferred is not in the permitted set', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      preferred: 'de',
      cookie: 'es',
    })
    expect(out).toBe('es')
  })

  it('falls through when preferred is null', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      preferred: null,
      cookie: 'fr',
    })
    expect(out).toBe('fr')
  })
})

describe('resolveInterfaceLocale — tier 2 (cookie)', () => {
  it('wins over Accept-Language', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      cookie: 'es',
      acceptLanguage: 'fr;q=0.9',
    })
    expect(out).toBe('es')
  })

  it('falls through when cookie points at a removed locale', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      cookie: 'de',
      acceptLanguage: 'fr;q=0.9',
    })
    expect(out).toBe('fr')
  })

  it('falls through when cookie is null', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      cookie: null,
      acceptLanguage: 'fr;q=0.9',
    })
    expect(out).toBe('fr')
  })
})

describe('resolveInterfaceLocale — tier 3 (Accept-Language)', () => {
  it('picks the best match from the header', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      acceptLanguage: 'fr-CA;q=0.9, fr;q=0.8, en;q=0.5',
    })
    expect(out).toBe('fr')
  })

  it('falls back to default when no header language is in the permitted set', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      acceptLanguage: 'de;q=0.9, ja;q=0.5',
    })
    expect(out).toBe(defaultLocale)
  })

  it('handles malformed headers gracefully', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      acceptLanguage: 'this-is-not-a-valid-header',
    })
    // intl-localematcher returns the default when no match; this is the
    // pure-fallback path.
    expect(out).toBe(defaultLocale)
  })
})

describe('resolveInterfaceLocale — tier 4 (default)', () => {
  it('returns defaultLocale when every other tier produces nothing', () => {
    const out = resolveInterfaceLocale({ locales, defaultLocale })
    expect(out).toBe('en')
  })

  it('returns defaultLocale when every signal is empty', () => {
    const out = resolveInterfaceLocale({
      locales,
      defaultLocale,
      preferred: null,
      cookie: null,
      acceptLanguage: null,
    })
    expect(out).toBe('en')
  })
})
