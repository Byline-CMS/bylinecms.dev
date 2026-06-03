/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { defineServerConfig, orderByContentLocale } from './config.js'
import type { ServerConfig } from '@/@types/index.js'

/**
 * `orderByContentLocale` sorts a set of locale codes by the configured
 * content-locale order (`i18n.content.locales`), with unknown codes last.
 * The advertised set's array order is meaningless,
 * so this is what makes it deterministic and config-driven at the read
 * source. Content locales here are configured `en, fr, es, de`.
 */
describe('orderByContentLocale', () => {
  beforeAll(() => {
    // Only `collections` is validated by `defineServerConfig`; the rest of
    // the shape is irrelevant to this helper, so a minimal cast is enough.
    defineServerConfig({
      serverURL: 'http://test.local',
      i18n: {
        interface: { defaultLocale: 'en', locales: ['en'] },
        content: { defaultLocale: 'en', locales: ['en', 'fr', 'es', 'de'] },
      },
      collections: [],
    } as unknown as ServerConfig)
  })

  it('orders codes by configured content-locale order', () => {
    expect(orderByContentLocale(['de', 'en', 'es'])).toEqual(['en', 'es', 'de'])
  })

  it('keeps unknown codes present, ordered last', () => {
    // `xx` is absent from the content config — it survives the read but sorts
    // after every known code rather than throwing.
    expect(orderByContentLocale(['de', 'xx', 'en'])).toEqual(['en', 'de', 'xx'])
  })

  it('is independent of the input (advertise-declaration) order', () => {
    const expected = ['en', 'es', 'de']
    expect(orderByContentLocale(['es', 'de', 'en'])).toEqual(expected)
    expect(orderByContentLocale(['de', 'es', 'en'])).toEqual(expected)
    expect(orderByContentLocale(['en', 'de', 'es'])).toEqual(expected)
  })

  it('orders multiple unknown codes deterministically (alphabetical tiebreak)', () => {
    expect(orderByContentLocale(['zz', 'en', 'aa'])).toEqual(['en', 'aa', 'zz'])
  })

  it('does not mutate the input array', () => {
    const input = ['de', 'en']
    orderByContentLocale(input)
    expect(input).toEqual(['de', 'en'])
  })
})

/**
 * Robustness around the configured-set boundary (raised by: interface locales
 * are a *different* set from content locales — see `apps/webapp/byline/locales.ts`
 * — and `localeDefinitions` may be partial). The order is taken from the
 * authoritative `content.locales`; anything outside it sorts last but is never
 * dropped.
 */
describe('orderByContentLocale — boundary robustness', () => {
  beforeAll(() => {
    defineServerConfig({
      serverURL: 'http://test.local',
      i18n: {
        // Interface set (`en`, `de`) deliberately overlaps content only on `en`
        // — `de` is interface-only here, NOT a content locale.
        interface: { defaultLocale: 'en', locales: ['en', 'de'] },
        content: {
          defaultLocale: 'en',
          locales: ['en', 'fr', 'es'],
          // Partial labels overlay — only `en`/`fr`. `es` is a content locale
          // with no label; it must still order correctly (not fall to the end).
          localeDefinitions: [
            { code: 'en', nativeName: 'English' },
            { code: 'fr', nativeName: 'Français' },
          ],
        },
      },
      collections: [],
    } as unknown as ServerConfig)
  })

  it('orders by content.locales even when localeDefinitions is partial', () => {
    // `es` (unlabelled content locale) must keep its content-order slot, not
    // be treated as unknown.
    expect(orderByContentLocale(['es', 'en', 'fr'])).toEqual(['en', 'fr', 'es'])
  })

  it('sorts an interface-only locale (not in content) last, never dropping it', () => {
    // `de` is an interface locale but not a content locale — preserved, last.
    expect(orderByContentLocale(['de', 'en', 'fr'])).toEqual(['en', 'fr', 'de'])
  })
})
