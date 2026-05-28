/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { createFormatter } from './formatter.js'
import type { TranslationBundle } from './types.js'

const bundle: TranslationBundle = {
  en: {
    'byline-admin': {
      'common.actions.save': 'Save',
      'common.actions.cancel': 'Cancel',
      'list.unread': '{count, plural, one {# unread} other {# unread}}',
      'doc.publishedOn': 'Published on {date, date, medium}',
      'errors.malformed': 'Hello {name', // unclosed brace — ICU parse failure
    },
    'plugin-x': {
      'btn.go': 'Go',
    },
  },
  fr: {
    'byline-admin': {
      'common.actions.save': 'Enregistrer',
      // intentionally missing 'common.actions.cancel' — exercises default-locale fallback
    },
  },
}

describe('createFormatter — basic lookups', () => {
  it('returns the active-locale translation for a known key', () => {
    const f = createFormatter({ bundle, activeLocale: 'en', defaultLocale: 'en' })
    expect(f.t('byline-admin', 'common.actions.save')).toBe('Save')
  })

  it('honours the active locale over the default locale', () => {
    const f = createFormatter({ bundle, activeLocale: 'fr', defaultLocale: 'en' })
    expect(f.t('byline-admin', 'common.actions.save')).toBe('Enregistrer')
  })

  it('looks up across namespaces independently', () => {
    const f = createFormatter({ bundle, activeLocale: 'en', defaultLocale: 'en' })
    expect(f.t('plugin-x', 'btn.go')).toBe('Go')
  })
})

describe('createFormatter — ICU formatting', () => {
  it('formats plurals correctly', () => {
    const f = createFormatter({ bundle, activeLocale: 'en', defaultLocale: 'en' })
    expect(f.t('byline-admin', 'list.unread', { count: 1 })).toBe('1 unread')
    expect(f.t('byline-admin', 'list.unread', { count: 5 })).toBe('5 unread')
  })

  it('formats dates against the active locale', () => {
    const f = createFormatter({ bundle, activeLocale: 'en', defaultLocale: 'en' })
    const fixedDate = new Date('2026-05-28T00:00:00Z')
    const result = f.t('byline-admin', 'doc.publishedOn', { date: fixedDate })
    // Don't pin the exact phrasing — Intl output varies by Node version /
    // ICU data — but it should contain the year and start with "Published".
    expect(result).toMatch(/^Published on .*2026/)
  })
})

describe('createFormatter — fallback chain', () => {
  it('falls back to the default locale when the active locale misses', () => {
    const onMissing = vi.fn()
    const f = createFormatter({
      bundle,
      activeLocale: 'fr',
      defaultLocale: 'en',
      onMissing,
    })
    expect(f.t('byline-admin', 'common.actions.cancel')).toBe('Cancel')
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(onMissing).toHaveBeenCalledWith({
      activeLocale: 'fr',
      namespace: 'byline-admin',
      key: 'common.actions.cancel',
      fellThroughToKey: false,
    })
  })

  it('falls back to the raw key when both locales miss', () => {
    const onMissing = vi.fn()
    const f = createFormatter({
      bundle,
      activeLocale: 'fr',
      defaultLocale: 'en',
      onMissing,
    })
    expect(f.t('byline-admin', 'does.not.exist')).toBe('does.not.exist')
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(onMissing).toHaveBeenCalledWith({
      activeLocale: 'fr',
      namespace: 'byline-admin',
      key: 'does.not.exist',
      fellThroughToKey: true,
    })
  })

  it('reports each missing key only once per formatter instance', () => {
    const onMissing = vi.fn()
    const f = createFormatter({
      bundle,
      activeLocale: 'fr',
      defaultLocale: 'en',
      onMissing,
    })
    // Three calls for the same missing key.
    f.t('byline-admin', 'common.actions.cancel')
    f.t('byline-admin', 'common.actions.cancel')
    f.t('byline-admin', 'common.actions.cancel')
    expect(onMissing).toHaveBeenCalledTimes(1)
  })

  it('does not fire onMissing when active and default are the same and the key exists', () => {
    const onMissing = vi.fn()
    const f = createFormatter({
      bundle,
      activeLocale: 'en',
      defaultLocale: 'en',
      onMissing,
    })
    f.t('byline-admin', 'common.actions.save')
    expect(onMissing).not.toHaveBeenCalled()
  })
})

describe('createFormatter — malformed messages', () => {
  it('returns the raw key when ICU parsing fails', () => {
    const onMissing = vi.fn()
    const f = createFormatter({
      bundle,
      activeLocale: 'en',
      defaultLocale: 'en',
      onMissing,
    })
    expect(f.t('byline-admin', 'errors.malformed', { name: 'Alice' })).toBe('errors.malformed')
  })

  it('caches the parse failure so we do not re-parse on repeated calls', () => {
    // No direct way to observe the cache, but the same call repeated should
    // be cheap and produce the same fallback string deterministically.
    const f = createFormatter({ bundle, activeLocale: 'en', defaultLocale: 'en' })
    const first = f.t('byline-admin', 'errors.malformed')
    const second = f.t('byline-admin', 'errors.malformed')
    expect(first).toBe('errors.malformed')
    expect(second).toBe('errors.malformed')
  })
})

describe('createFormatter — exposed metadata', () => {
  it('exposes activeLocale and defaultLocale', () => {
    const f = createFormatter({ bundle, activeLocale: 'fr', defaultLocale: 'en' })
    expect(f.activeLocale).toBe('fr')
    expect(f.defaultLocale).toBe('en')
  })
})
