/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The link-target form's state machine, extracted from `LinkModal` so both
 * it and the inline-image modal drive the same rules — and so those rules
 * are testable without rendering React (this repo carries no React
 * testing library; the JSX shell is verified in the browser).
 *
 * Two callers with one asymmetry: a `LinkNode` always has a target, so
 * `allowNone` is false there. An inline image's target is optional, so
 * `allowNone` is true and `toLinkAttributes` can return undefined — which
 * is how an editor removes a link.
 */

import { describe, expect, it } from 'vitest'

import { fromLinkAttributes, toLinkAttributes, validateLinkTarget } from './link-target-state'
import type { DocumentRelation } from '../../nodes/document-relation'
import type { LinkAttributes } from '.'

const linkable = [
  { path: 'pages', labels: { singular: 'Page', plural: 'Pages' } },
  { path: 'posts', labels: { singular: 'Post', plural: 'Posts' } },
] as any[]

const picked: DocumentRelation = {
  targetDocumentId: 'doc-1',
  targetCollectionId: 'coll-pages',
  targetCollectionPath: 'pages',
  document: { title: 'About Us', path: '/pages/about' },
}

const internalLink: LinkAttributes = {
  linkType: 'internal',
  newTab: false,
  targetDocumentId: 'doc-1',
  targetCollectionId: 'coll-pages',
  targetCollectionPath: 'pages',
  document: { title: 'About Us', path: '/pages/about' },
}

const customLink: LinkAttributes = {
  linkType: 'custom',
  url: 'https://example.com/report',
  newTab: true,
}

/** The empty state is reached through the module's one entry point. */
const empty = (linkable: any[], options: { allowNone: boolean }) =>
  fromLinkAttributes(undefined, linkable as never, options)

describe('the starting state', () => {
  it('starts on "none" when the caller allows an absent target', () => {
    expect(empty(linkable, { allowNone: true }).kind).toBe('none')
  })

  it('starts on "internal" when a target is required and collections are linkable', () => {
    expect(empty(linkable, { allowNone: false }).kind).toBe('internal')
  })

  it('falls back to "custom" when no collection opts into the editor picker', () => {
    expect(empty([], { allowNone: false }).kind).toBe('custom')
  })

  it('seeds the picker onto the first linkable collection', () => {
    expect(empty(linkable, { allowNone: false }).targetCollection).toBe('pages')
  })
})

describe('fromLinkAttributes', () => {
  it('reads an absent link as "none" when that is allowed', () => {
    expect(fromLinkAttributes(undefined, linkable, { allowNone: true }).kind).toBe('none')
  })

  it('loads a custom URL', () => {
    const state = fromLinkAttributes(customLink, linkable, { allowNone: true })
    expect(state.kind).toBe('custom')
    expect(state.url).toBe('https://example.com/report')
    expect(state.newTab).toBe(true)
  })

  it('loads an internal relation and points the picker at its collection', () => {
    const state = fromLinkAttributes(internalLink, linkable, { allowNone: true })
    expect(state.kind).toBe('internal')
    expect(state.picked).toEqual(picked)
    expect(state.targetCollection).toBe('pages')
  })

  // LinkModal's existing behaviour: the toolbar inserts a placeholder link
  // with `https://`, which means "the user has not chosen yet" — so prefer
  // the document picker rather than showing a URL box pre-filled with junk.
  it.each(['', 'https://'])(
    'treats the placeholder url %j as undecided and prefers the picker',
    (url) => {
      const state = fromLinkAttributes({ linkType: 'custom', url }, linkable, { allowNone: false })
      expect(state.kind).toBe('internal')
      expect(state.url).toBe('')
    }
  )

  it('does not surface the placeholder url in the input', () => {
    const state = fromLinkAttributes({ linkType: 'custom', url: 'https://' }, [], {
      allowNone: false,
    })
    expect(state.kind).toBe('custom')
    expect(state.url).toBe('')
  })
})

describe('toLinkAttributes', () => {
  it('returns undefined for "none" — this is how a link is removed', () => {
    const state = empty(linkable, { allowNone: true })
    expect(toLinkAttributes(state)).toBeUndefined()
  })

  it('builds a custom link', () => {
    const state = {
      ...empty([], { allowNone: true }),
      kind: 'custom' as const,
      url: 'https://example.com/report',
      newTab: true,
    }
    expect(toLinkAttributes(state)).toEqual(customLink)
  })

  it('builds an internal link carrying the picked relation envelope', () => {
    const state = {
      ...empty(linkable, { allowNone: true }),
      kind: 'internal' as const,
      picked,
      newTab: false,
    }
    expect(toLinkAttributes(state)).toEqual(internalLink)
  })

  it('returns undefined for an internal selection with nothing picked', () => {
    const state = {
      ...empty(linkable, { allowNone: true }),
      kind: 'internal' as const,
    }
    expect(toLinkAttributes(state)).toBeUndefined()
  })

  it.each([customLink, internalLink])('round-trips %#', (link) => {
    expect(toLinkAttributes(fromLinkAttributes(link, linkable, { allowNone: true }))).toEqual(link)
  })
})

describe('validateLinkTarget', () => {
  it('accepts "none"', () => {
    expect(validateLinkTarget(empty(linkable, { allowNone: true }))).toBeNull()
  })

  it.each(['https://example.com', '/docs/getting-started', 'mailto:a@example.com'])(
    'accepts %s as a custom target',
    (url) => {
      const state = {
        ...empty([], { allowNone: true }),
        kind: 'custom' as const,
        url,
      }
      expect(validateLinkTarget(state)).toBeNull()
    }
  )

  it('rejects an empty custom URL', () => {
    const state = {
      ...empty([], { allowNone: true }),
      kind: 'custom' as const,
      url: '',
    }
    expect(validateLinkTarget(state)).toBeTruthy()
  })

  it('rejects an internal selection with no document picked', () => {
    const state = {
      ...empty(linkable, { allowNone: true }),
      kind: 'internal' as const,
    }
    expect(validateLinkTarget(state)).toBeTruthy()
  })

  it('accepts an internal selection once a document is picked', () => {
    const state = {
      ...empty(linkable, { allowNone: true }),
      kind: 'internal' as const,
      picked,
    }
    expect(validateLinkTarget(state)).toBeNull()
  })
})
