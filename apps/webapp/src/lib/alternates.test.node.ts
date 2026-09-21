import { describe, expect, it, vi } from 'vitest'

import { i18nConfig } from '@/i18n/i18n-config'
import { advertisedLocalesFor, resolveAlternates } from '@/lib/alternates'
import { generateLlmsTxt } from '@/lib/llms'
import { getMeta } from '@/lib/meta'
import { generateSitemap, getStaticSitemap } from '@/lib/sitemap'

vi.mock('@/config', () => ({
  getPublicConfig: () => ({
    siteName: 'Example',
    siteDescription: 'Example site',
    serverUrl: 'https://example.com',
  }),
}))

// Deliberately different from the interface default to catch use of the wrong
// legacy floor. All non-legacy fixtures below carry their document source.
vi.mock('~/public', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  defaultContentLocale: 'de',
}))

describe('editorial canonical policy', () => {
  it.each(['en', 'es', 'fr', 'de', 'zh-CN', 'th-TH'])(
    'consolidates an English-only document requested in %s',
    (pathLocale) => {
      const result = resolveAlternates(
        { advertisedLocales: ['en'], pathLocale, sourceLocale: 'en' },
        'docs',
        'getting-started',
        'development'
      )
      expect(result).toEqual({
        canonical: '/docs/getting-started/development',
        alternates: [{ hreflang: 'en', path: '/docs/getting-started/development' }],
        xDefaultPath: '/docs/getting-started/development',
      })
    }
  )

  it('keeps approved translations self-canonical with the same reciprocal cluster', () => {
    const options = { advertisedLocales: ['en', 'es', 'fr'], sourceLocale: 'en' }
    const spanish = resolveAlternates({ ...options, pathLocale: 'es' }, 'about')
    const french = resolveAlternates({ ...options, pathLocale: 'fr' }, 'about')
    expect(spanish.canonical).toBe('/es/about')
    expect(french.canonical).toBe('/fr/about')
    expect(spanish.alternates).toEqual(french.alternates)
    expect(spanish.alternates).toContainEqual({ hreflang: 'es', path: spanish.canonical })
  })

  it.each([
    { availableLocales: ['en'], _availableVersionLocales: ['en', 'es'] },
    { availableLocales: ['en', 'es'], _availableVersionLocales: ['en'] },
  ])('requires both editorial approval and completeness: %j', (doc) => {
    const result = resolveAlternates(
      { advertisedLocales: advertisedLocalesFor(doc), pathLocale: 'es', sourceLocale: 'en' },
      'article'
    )
    expect(result.canonical).toBe('/article')
    expect(result.alternates).toEqual([{ hreflang: 'en', path: '/article' }])
  })

  it.each([{ set: [] }, { set: undefined }, { set: null }])(
    'keeps the source canonical with no advertised locales: %j',
    ({ set }) => {
      const result = resolveAlternates(
        { advertisedLocales: set, pathLocale: 'es', sourceLocale: 'fr' },
        'legal',
        'privacy'
      )
      expect(result.canonical).toBe('/fr/legal/privacy')
      expect(result.xDefaultPath).toBe('/fr/legal/privacy')
      const head = getMeta({ path: result.canonical, ...result })
      expect(head.links).toEqual([
        { rel: 'canonical', href: 'https://example.com/fr/legal/privacy' },
      ])
    }
  )

  it('allows an unadvertised source as x-default without adding a language entry', () => {
    const result = resolveAlternates(
      { advertisedLocales: ['es', 'fr'], pathLocale: 'es', sourceLocale: 'en' },
      'article'
    )
    expect(result.canonical).toBe('/es/article')
    expect(result.xDefaultPath).toBe('/article')
    expect(result.alternates.map((link) => link.hreflang)).toEqual(['es', 'fr'])
    expect(
      resolveAlternates(
        { advertisedLocales: ['es', 'fr'], pathLocale: 'en', sourceLocale: 'en' },
        'article'
      ).canonical
    ).toBe('/article')
  })

  it('uses the content default only when the source marker is missing', () => {
    expect(resolveAlternates({ pathLocale: 'es' }, 'legacy').canonical).toBe('/de/legacy')
    expect(resolveAlternates({ pathLocale: 'es', sourceLocale: 'fr' }, 'anchored').canonical).toBe(
      '/fr/anchored'
    )
  })

  it('collapses locale-agnostic documents with an empty completeness ledger to their source', () => {
    const doc = { availableLocales: ['en', 'es'], _availableVersionLocales: [] }
    expect(
      resolveAlternates(
        { advertisedLocales: advertisedLocalesFor(doc), pathLocale: 'es', sourceLocale: 'en' },
        'neutral'
      ).canonical
    ).toBe('/neutral')
  })

  it('keeps canonical, Open Graph, and the Markdown advertisement aligned', () => {
    const resolved = resolveAlternates(
      { advertisedLocales: ['fr'], pathLocale: 'es', sourceLocale: 'fr' },
      'news',
      'article'
    )
    const head = getMeta({
      path: resolved.canonical,
      alternates: resolved.alternates,
      xDefaultPath: resolved.xDefaultPath,
      markdownAlternatePath: `${resolved.canonical}.md`,
    })
    const canonical = 'https://example.com/fr/news/article'
    expect(head.links.filter((link) => link.rel === 'canonical')).toEqual([
      { rel: 'canonical', href: canonical },
    ])
    expect(head.meta).toContainEqual({ property: 'og:url', content: canonical })
    expect(head.links).toContainEqual({
      rel: 'alternate',
      type: 'text/markdown',
      href: `${canonical}.md`,
    })
    expect(head.links).toContainEqual({ rel: 'alternate', hrefLang: 'x-default', href: canonical })
    expect(getMeta().links.some((link) => link.rel === 'canonical')).toBe(false)
  })

  it('uses the source baseline in the sitemap and Markdown discovery index', () => {
    const entry = { segments: ['news', 'article'], sourceLocale: 'fr', advertisedLocales: ['es'] }
    const xml = generateSitemap([entry], 'https://example.com')
    expect(xml).toContain('<loc>https://example.com/fr/news/article</loc>')
    expect(xml).toContain('hreflang="es" href="https://example.com/es/news/article"')
    expect(xml).toContain('hreflang="x-default" href="https://example.com/fr/news/article"')
    expect(xml).not.toContain('hreflang="fr"')
    expect(
      generateLlmsTxt([{ title: 'News', entries: [entry] }], {
        name: 'Example',
        serverUrl: 'https://example.com',
      })
    ).toContain('(https://example.com/fr/news/article.md)')
  })

  it('preserves static-page defaults independently of the content default', async () => {
    const pathLocale = i18nConfig.locales[1]
    const head = resolveAlternates({
      advertisedLocales: i18nConfig.locales,
      pathLocale,
      sourceLocale: i18nConfig.defaultLocale,
    })
    expect(head.canonical).toBe(`/${pathLocale}`)
    expect(head.xDefaultPath).toBe('/')
    const xml = generateSitemap(await getStaticSitemap(), 'https://example.com')
    expect(xml).toContain('<loc>https://example.com/docs</loc>')
    expect(xml).not.toContain('<loc>https://example.com/de/docs</loc>')
  })
})
