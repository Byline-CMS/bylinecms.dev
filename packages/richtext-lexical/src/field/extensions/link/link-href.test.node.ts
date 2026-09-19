/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The internal-link fallback chain, as a pure function.
 *
 * Returning `null` is meaningful: it is the signal that no usable target
 * exists, and every caller reacts by degrading rather than by emitting a
 * broken href — the editor hides its cmd-click affordance, the markdown
 * serializer drops the wrapper, the public renderer strips the anchor.
 */

import { describe, expect, it } from 'vitest'

import { resolveLinkHref } from './link-href'
import type { LinkAttributes } from '.'

const internal = (document?: Record<string, unknown>): LinkAttributes => ({
  linkType: 'internal',
  targetDocumentId: 'doc-1',
  targetCollectionId: 'coll-1',
  targetCollectionPath: 'pages',
  document: document as any,
})

describe('resolveLinkHref', () => {
  it('returns null for an absent link', () => {
    expect(resolveLinkHref(undefined)).toBeNull()
  })

  describe('custom targets', () => {
    it.each([
      'https://example.com/report',
      '/docs/getting-started',
      'mailto:hello@example.com',
      '#section',
    ])('passes %s through unchanged', (url) => {
      expect(resolveLinkHref({ linkType: 'custom', url })).toBe(url)
    })

    it.each([undefined, ''])('returns null for a %j url', (url) => {
      expect(resolveLinkHref({ linkType: 'custom', url })).toBeNull()
    })
  })

  describe('internal targets', () => {
    it('uses a canonical path written by the embed walker', () => {
      expect(resolveLinkHref(internal({ path: '/about-us' }))).toBe('/about-us')
    })

    it('composes a bare slug against the target collection', () => {
      expect(resolveLinkHref(internal({ path: 'about' }))).toBe('/pages/about')
    })

    // The walker sets this when the target was deleted. The image must stay
    // on the page; only its click target goes away.
    it('returns null when the walker marked the target unresolved', () => {
      expect(resolveLinkHref(internal({ path: '/about-us', _resolved: false }))).toBeNull()
    })

    it.each([undefined, {}, { path: '' }])(
      'returns null when there is no path to build from (%j)',
      (document) => {
        expect(resolveLinkHref(internal(document))).toBeNull()
      }
    )

    it('returns null for a bare slug with no collection path to compose against', () => {
      const link = { ...internal({ path: 'about' }), targetCollectionPath: '' } as LinkAttributes
      expect(resolveLinkHref(link)).toBeNull()
    })
  })
})
