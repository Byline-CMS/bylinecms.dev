/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  adminTranslations,
  bundledLocales,
  de,
  en,
  es,
  fr,
  it as itBundle,
  ko,
  zhCN,
} from './index.js'

describe('bundled locale data', () => {
  it('exposes a non-empty bundledLocales list', () => {
    expect(bundledLocales.length).toBeGreaterThan(0)
    expect(bundledLocales).toContain('en')
  })

  it('exports the en bundle as a flat key → string record', () => {
    const keys = Object.keys(en)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(typeof en[key]).toBe('string')
    }
  })

  it('exports the fr bundle with the same key set as en (no drift)', () => {
    expect(new Set(Object.keys(fr))).toEqual(new Set(Object.keys(en)))
  })

  it.each([
    ['es', es],
    ['de', de],
    ['it', itBundle],
    ['zh-CN', zhCN],
    ['ko', ko],
  ])('exports the %s bundle with the same key set as en (no drift)', (_code, bundle) => {
    expect(new Set(Object.keys(bundle))).toEqual(new Set(Object.keys(en)))
  })

  it('carries at least the headline action keys', () => {
    expect(en['common.actions.save']).toBe('Save')
    expect(fr['common.actions.save']).toBe('Enregistrer')
  })

  it('translates every tree and delete-warning key in each non-English bundle', () => {
    const keys = [
      'collections.list.treeConflictToast',
      'collections.list.treeConflictDescription',
      'collections.list.treeHookFailedToast',
      'collections.list.treeHookFailedDescription',
      'collections.list.treeRefreshFailedToast',
      'collections.list.treeRefreshFailedDescription',
      'collections.edit.deletedWithWarningsDescription',
    ] as const
    const nonEnglishBundles = { fr, es, de, it: itBundle, 'zh-CN': zhCN, ko } as const

    expect(Object.keys(nonEnglishBundles)).toEqual(
      bundledLocales.filter((locale) => locale !== 'en')
    )
    for (const key of keys) {
      expect(en[key].trim(), `${key} must be non-empty in en`).not.toBe('')
      for (const [locale, bundle] of Object.entries(nonEnglishBundles)) {
        expect(bundle[key].trim(), `${key} must be non-empty in ${locale}`).not.toBe('')
        expect(bundle[key], `${key} must be translated in ${locale}`).not.toBe(en[key])
      }
    }
  })
})

describe('adminTranslations()', () => {
  it('defaults to the English byline-admin namespace when called with no args', () => {
    const bundle = adminTranslations()
    expect(bundle.en?.['byline-admin']?.['common.actions.save']).toBe('Save')
    expect(bundle.fr).toBeUndefined()
  })

  it('returns only the requested locales', () => {
    const bundle = adminTranslations({ locales: ['en', 'fr'] })
    expect(bundle.en?.['byline-admin']?.['common.actions.save']).toBe('Save')
    expect(bundle.fr?.['byline-admin']?.['common.actions.save']).toBe('Enregistrer')
  })

  it('returns an empty bundle when an empty locales list is passed', () => {
    const bundle = adminTranslations({ locales: [] })
    expect(bundle).toEqual({})
  })

  it('throws on an unknown locale code with the available set in the message', () => {
    expect(() => adminTranslations({ locales: ['xx'] })).toThrow(/no bundled translation/i)
    expect(() => adminTranslations({ locales: ['xx'] })).toThrow(/Available:.*en/i)
  })

  it('preserves locale order in the returned bundle keys', () => {
    const bundle = adminTranslations({ locales: ['fr', 'en'] })
    expect(Object.keys(bundle)).toEqual(['fr', 'en'])
  })

  it('every code in bundledLocales is accepted', () => {
    expect(() => adminTranslations({ locales: bundledLocales })).not.toThrow()
  })
})
