/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { isLocalizablePath, localeInputRewrite, localeOutputRewrite } from '@/i18n/locale-rewrite'

const ORIGIN = 'https://example.com'

/** Run a rewrite over a pathname and return the resulting pathname. */
function input(pathname: string): string {
  return localeInputRewrite(new URL(pathname, ORIGIN)).pathname
}
function output(pathname: string): string {
  return localeOutputRewrite(new URL(pathname, ORIGIN)).pathname
}

describe('localeInputRewrite — the matcher always sees a locale segment', () => {
  it('prepends the default locale to bare frontend paths', () => {
    expect(input('/')).toBe('/en')
    expect(input('/about-byline')).toBe('/en/about-byline')
    expect(input('/news/some-story')).toBe('/en/news/some-story')
  })

  it('leaves an existing routable locale prefix untouched', () => {
    // interface locale
    expect(input('/fr')).toBe('/fr')
    expect(input('/fr/about-byline')).toBe('/fr/about-byline')
    // default locale typed explicitly — not double-prefixed
    expect(input('/en/about-byline')).toBe('/en/about-byline')
    // content-only locales, including hyphenated codes
    expect(input('/es/news/x')).toBe('/es/news/x')
    expect(input('/zh-CN/news/x')).toBe('/zh-CN/news/x')
    expect(input('/th-TH')).toBe('/th-TH')
  })

  it('never prefixes the locale-less admin / system surface', () => {
    expect(input('/admin')).toBe('/admin')
    expect(input('/admin/collections/pages')).toBe('/admin/collections/pages')
    expect(input('/sign-in')).toBe('/sign-in')
    expect(input('/_serverFn/foo')).toBe('/_serverFn/foo')
    expect(input('/_build/assets/app.js')).toBe('/_build/assets/app.js')
    expect(input('/uploads/img.png')).toBe('/uploads/img.png')
    expect(input('/api/whatever')).toBe('/api/whatever')
  })

  it('never prefixes static assets', () => {
    expect(input('/favicon.ico')).toBe('/favicon.ico')
    expect(input('/site.webmanifest')).toBe('/site.webmanifest')
    expect(input('/fonts/Inter/Inter.woff2')).toBe('/fonts/Inter/Inter.woff2')
    expect(input('/apple-touch-icon.png')).toBe('/apple-touch-icon.png')
  })

  it('treats `.md` as content, not asset — localized like the HTML page', () => {
    // The markdown representation lives at canonical URL + `.md`, one
    // variant per content locale (TODO-INTERNAL.md → markdown export).
    expect(input('/docs/getting-started.md')).toBe('/en/docs/getting-started.md')
    expect(input('/fr/docs/getting-started.md')).toBe('/fr/docs/getting-started.md')
    expect(input('/news/some-post.md')).toBe('/en/news/some-post.md')
    // Hierarchical (tree) docs URLs localize the same way at any depth — the
    // `.md` suffixed splat (`docs/{$}.md`) serves a markdown variant per
    // content locale. The asset heuristic checks only the last segment, so a
    // multi-segment path with `.md` still localizes.
    expect(input('/docs/getting-started/cli.md')).toBe('/en/docs/getting-started/cli.md')
    expect(input('/fr/docs/getting-started/cli.md')).toBe('/fr/docs/getting-started/cli.md')
    // Other text-ish extensions stay assets (llms.txt is a locale-less
    // top-level surface like sitemap.xml).
    expect(input('/llms.txt')).toBe('/llms.txt')
  })

  it('preserves search and hash', () => {
    const url = new URL('/about-byline?ref=nav#team', ORIGIN)
    const out = localeInputRewrite(url)
    expect(out.pathname).toBe('/en/about-byline')
    expect(out.search).toBe('?ref=nav')
    expect(out.hash).toBe('#team')
  })
})

describe('localeOutputRewrite — de-DEFAULT, never de-LOCALIZE', () => {
  it('strips a leading default-locale segment for clean URLs', () => {
    expect(output('/en')).toBe('/')
    expect(output('/en/about-byline')).toBe('/about-byline')
    expect(output('/en/news/some-story')).toBe('/news/some-story')
  })

  it('PRESERVES every non-default routable locale (the Axis-A/B guardrail)', () => {
    // non-default interface locale
    expect(output('/fr')).toBe('/fr')
    expect(output('/fr/about-byline')).toBe('/fr/about-byline')
    // content-only locales must remain visible — rendering + hreflang depend on it
    expect(output('/es/news/x')).toBe('/es/news/x')
    expect(output('/zh-CN/news/x')).toBe('/zh-CN/news/x')
    expect(output('/th-TH')).toBe('/th-TH')
  })

  it('leaves the locale-less admin / system surface untouched', () => {
    expect(output('/admin')).toBe('/admin')
    expect(output('/sign-in')).toBe('/sign-in')
    expect(output('/')).toBe('/')
  })

  it('does not strip a non-locale segment that merely starts with the locale code', () => {
    // `entry` starts with `en` but is not the `en` segment — must not be touched
    expect(output('/entry/foo')).toBe('/entry/foo')
  })
})

describe('input ∘ output round-trips to the original public URL', () => {
  for (const publicPath of ['/', '/about-byline', '/fr/about-byline', '/zh-CN/news/x']) {
    it(`${publicPath} survives output(input(path))`, () => {
      const internal = input(publicPath)
      expect(output(internal)).toBe(publicPath)
    })
  }
})

describe('isLocalizablePath', () => {
  it('classifies frontend vs system paths', () => {
    expect(isLocalizablePath('/')).toBe(true)
    expect(isLocalizablePath('/about-byline')).toBe(true)
    expect(isLocalizablePath('/fr/about-byline')).toBe(true)
    expect(isLocalizablePath('/admin')).toBe(false)
    expect(isLocalizablePath('/_serverFn/x')).toBe(false)
    expect(isLocalizablePath('/favicon.ico')).toBe(false)
    expect(isLocalizablePath('/docs/getting-started.md')).toBe(true)
    expect(isLocalizablePath('/sitemap.xml')).toBe(false)
  })
})
