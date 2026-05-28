/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { adminTranslations, en } from './index.js'

describe('en bundle', () => {
  it('is a non-empty flat key → string record', () => {
    const keys = Object.keys(en)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(typeof en[key]).toBe('string')
    }
  })

  it('carries at least the headline action keys', () => {
    expect(en['common.actions.save']).toBe('Save')
    expect(en['common.actions.cancel']).toBe('Cancel')
  })
})

describe('adminTranslations()', () => {
  it('returns the English byline-admin namespace by default', () => {
    const bundle = adminTranslations()
    expect(bundle.en?.['byline-admin']?.['common.actions.save']).toBe('Save')
  })

  it('omits English when called with { en: false }', () => {
    const bundle = adminTranslations({ en: false })
    expect(bundle.en).toBeUndefined()
  })

  it('accepts a community bundle under another locale code', () => {
    const fr = { 'common.actions.save': 'Enregistrer' }
    const bundle = adminTranslations({ en: true, fr })
    expect(bundle.en?.['byline-admin']?.['common.actions.save']).toBe('Save')
    expect(bundle.fr?.['byline-admin']?.['common.actions.save']).toBe('Enregistrer')
  })

  it('lets a custom English NamespaceTranslations override the bundled defaults', () => {
    const bundle = adminTranslations({ en: { 'common.actions.save': 'Stash it' } })
    expect(bundle.en?.['byline-admin']?.['common.actions.save']).toBe('Stash it')
  })

  it('throws when a non-en locale is passed as `true` (only bundled-English supports the shorthand)', () => {
    expect(() => adminTranslations({ en: true, fr: true as never })).toThrow(/only valid for 'en'/i)
  })
})
