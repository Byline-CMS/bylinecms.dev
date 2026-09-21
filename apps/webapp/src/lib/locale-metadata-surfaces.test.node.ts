import { beforeEach, describe, expect, it, vi } from 'vitest'

import { contentLocales } from '@/i18n/i18n-config'
import { getDocumentMarkdown } from '@/lib/markdown'
import { getDocsSitemap } from '@/modules/docs/sitemap'

const mocks = vi.hoisted(() => ({
  findByPath: vi.fn(),
  getSubtree: vi.fn(),
  serialize: vi.fn(() => 'serialized markdown'),
}))

vi.mock('@byline/client/server', () => ({
  getPublicBylineClient: () => ({
    collection: () => ({ findByPath: mocks.findByPath, getSubtree: mocks.getSubtree }),
  }),
}))
vi.mock('@byline/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  documentToMarkdown: mocks.serialize,
  getCollectionDefinition: () => ({ path: 'docs' }),
  getServerConfig: () => ({}),
}))
vi.mock('@/lib/cache/with-cache', () => ({
  withCache: ({ fn }: { fn: () => unknown }) => fn(),
  cacheKeys: { details: () => 'details', sitemap: () => 'sitemap' },
  tags: { details: () => 'details', collection: () => 'collection', sitemap: () => 'sitemap' },
}))
vi.mock('@/config', () => ({
  getPublicConfig: () => ({ serverUrl: 'https://example.com' }),
}))

beforeEach(() => vi.clearAllMocks())

const translationLocale = contentLocales.find((locale) => locale !== 'en') ?? 'en'

describe('locale metadata across public surfaces', () => {
  it('uses editorial canonical policy in Markdown without changing the read or serialization locale', async () => {
    const doc = {
      sourceLocale: 'en',
      availableLocales: ['en'],
      _availableVersionLocales: ['en', translationLocale],
      fields: { title: 'Spanish translation, held back' },
    }
    mocks.findByPath.mockResolvedValue(doc)
    await getDocumentMarkdown({
      collection: 'docs',
      lng: translationLocale,
      path: 'article',
      canonicalSegments: ['docs', 'article'],
    })
    expect(mocks.findByPath).toHaveBeenCalledWith(
      'article',
      expect.objectContaining({ locale: translationLocale, status: 'published' })
    )
    expect(mocks.serialize).toHaveBeenCalledWith(
      doc,
      expect.anything(),
      expect.objectContaining({
        locale: translationLocale,
        canonicalUrl: 'https://example.com/docs/article',
      })
    )
  })

  it('keeps an approved Markdown translation canonical in its own locale', async () => {
    mocks.findByPath.mockResolvedValue({
      sourceLocale: 'en',
      availableLocales: [translationLocale],
      _availableVersionLocales: ['en', translationLocale],
      fields: {},
    })
    await getDocumentMarkdown({
      collection: 'docs',
      lng: translationLocale,
      path: 'article',
      canonicalSegments: ['docs', 'article'],
    })
    expect(mocks.serialize).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        canonicalUrl: `https://example.com/${translationLocale}/docs/article`,
      })
    )
  })

  it('preserves each tree document source through published enumeration and sitemap adaptation', async () => {
    mocks.getSubtree.mockResolvedValue([
      {
        document: {
          path: 'parent',
          sourceLocale: 'en',
          fields: {},
          availableLocales: ['en'],
          _availableVersionLocales: ['en'],
        },
        children: [
          {
            document: {
              path: 'child',
              sourceLocale: 'fr',
              fields: {},
              availableLocales: ['fr', 'es'],
              _availableVersionLocales: ['fr', 'es'],
            },
            children: [],
          },
        ],
      },
    ])
    expect(await getDocsSitemap()).toEqual([
      expect.objectContaining({
        segments: ['docs', 'parent'],
        sourceLocale: 'en',
        advertisedLocales: ['en'],
      }),
      expect.objectContaining({
        segments: ['docs', 'parent', 'child'],
        sourceLocale: 'fr',
        advertisedLocales: ['fr', 'es'],
      }),
    ])
  })
})
