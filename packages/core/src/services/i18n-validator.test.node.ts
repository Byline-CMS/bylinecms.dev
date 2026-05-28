/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { validateTranslations } from './i18n-validator.js'

describe('validateTranslations — happy paths', () => {
  it('passes when every declared locale has at least one (namespace, key)', () => {
    expect(() =>
      validateTranslations({
        defaultLocale: 'en',
        locales: ['en', 'fr'],
        translations: {
          en: { 'byline-admin': { foo: 'Foo' } },
          fr: { 'byline-admin': { foo: 'Foo (FR)' } },
        },
      })
    ).not.toThrow()
  })

  it('skips validation entirely when locales is empty (seed scripts, headless tooling)', () => {
    const result = validateTranslations({
      defaultLocale: 'en',
      locales: [],
    })
    expect(result.warnings).toEqual([])
  })

  it('returns no warnings when key sets are aligned across locales', () => {
    const result = validateTranslations({
      defaultLocale: 'en',
      locales: ['en', 'fr'],
      translations: {
        en: { 'byline-admin': { a: 'A', b: 'B' } },
        fr: { 'byline-admin': { a: 'A-fr', b: 'B-fr' } },
      },
    })
    expect(result.warnings).toEqual([])
  })
})

describe('validateTranslations — structural errors', () => {
  it('throws when defaultLocale is not in the permitted locales set', () => {
    expect(() =>
      validateTranslations({
        defaultLocale: 'de',
        locales: ['en', 'fr'],
        translations: {
          en: { 'byline-admin': { a: 'A' } },
          fr: { 'byline-admin': { a: 'A' } },
        },
      })
    ).toThrow(/defaultLocale 'de' is not in i18n\.interface\.locales/)
  })

  it('throws when locales is non-empty but no translations bundle is registered', () => {
    expect(() =>
      validateTranslations({
        defaultLocale: 'en',
        locales: ['en'],
      })
    ).toThrow(/no translations bundle is registered/)
  })

  it('throws when a declared locale has no namespaces in the bundle', () => {
    expect(() =>
      validateTranslations({
        defaultLocale: 'en',
        locales: ['en', 'fr'],
        translations: {
          en: { 'byline-admin': { a: 'A' } },
          // fr declared but no entry in the bundle
        },
      })
    ).toThrow(/'fr' but no translations are registered for it/)
  })

  it('throws when a declared locale has a namespace but zero keys', () => {
    expect(() =>
      validateTranslations({
        defaultLocale: 'en',
        locales: ['en', 'fr'],
        translations: {
          en: { 'byline-admin': { a: 'A' } },
          fr: { 'byline-admin': {} },
        },
      })
    ).toThrow(/'fr' but no translations are registered/)
  })

  it('reports every locale failure in one combined error', () => {
    expect(() =>
      validateTranslations({
        defaultLocale: 'en',
        locales: ['en', 'fr', 'de'],
        translations: {
          en: { 'byline-admin': { a: 'A' } },
        },
      })
    ).toThrow(/'fr' but no translations.*\n.*'de' but no translations/s)
  })
})

describe('validateTranslations — soft drift warnings', () => {
  it('flags keys missing in one locale but present in another (same namespace)', () => {
    const result = validateTranslations({
      defaultLocale: 'en',
      locales: ['en', 'fr'],
      translations: {
        en: { 'byline-admin': { a: 'A', b: 'B' } },
        fr: { 'byline-admin': { a: 'A-fr' } },
      },
    })
    expect(result.warnings).toEqual([
      { locale: 'fr', namespace: 'byline-admin', missingKeys: ['b'] },
    ])
  })

  it('flags drift across multiple namespaces independently', () => {
    const result = validateTranslations({
      defaultLocale: 'en',
      locales: ['en', 'fr'],
      translations: {
        en: {
          'byline-admin': { a: 'A' },
          'plugin-x': { foo: 'Foo', bar: 'Bar' },
        },
        fr: {
          'byline-admin': { a: 'A-fr' },
          'plugin-x': { foo: 'Foo-fr' },
        },
      },
    })
    expect(result.warnings).toEqual([{ locale: 'fr', namespace: 'plugin-x', missingKeys: ['bar'] }])
  })

  it('reports drift in both directions when neither locale is a superset', () => {
    const result = validateTranslations({
      defaultLocale: 'en',
      locales: ['en', 'fr'],
      translations: {
        en: { 'byline-admin': { a: 'A', b: 'B' } },
        fr: { 'byline-admin': { a: 'A-fr', c: 'C-fr' } },
      },
    })
    // en is missing 'c' (present in fr); fr is missing 'b' (present in en).
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        { locale: 'en', namespace: 'byline-admin', missingKeys: ['c'] },
        { locale: 'fr', namespace: 'byline-admin', missingKeys: ['b'] },
      ])
    )
  })
})
